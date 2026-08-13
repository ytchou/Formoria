import { createClient } from "@libsql/client";

import {
  AgentHubMissingAgentError,
  AgentHubPausedAgentError,
  AgentHubStoreError,
  createAgentHubWriter,
} from "./writer.mjs";

const RUN_COLUMNS = [
  "id",
  "agent_id",
  "actions",
  "completed_at",
  "cost_usd",
  "created_at",
  "duration_ms",
  "error",
  "log_url",
  "metadata",
  "model",
  "report_date",
  "run_number",
  "source_run_id",
  "started_at",
  "status",
  "summary",
  "tokens_input",
  "tokens_output",
  "verdict_severity",
  "verdict_text",
];
const LOCAL_BUSY_TIMEOUT_MS = 250;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowValue(row, key) {
  return isRecord(row) ? row[key] : undefined;
}

function requiredEnvironment(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new AgentHubStoreError(`${name} is required`, {
      code: "agent_hub_configuration",
    });
  }
  return value;
}

function jsonValue(value, field) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new AgentHubStoreError(`${field} is not JSON serializable`, {
      code: "invalid_run_value",
      cause: error,
    });
  }
}

function isTransientTursoError(error) {
  if (error && error.retryable === true) return true;
  const code = String(error?.code ?? "").toUpperCase();
  const message = String(error?.message ?? "");
  return (
    /^(?:ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|SQLITE_BUSY|SQLITE_BUSY_SNAPSHOT|SQLITE_IOERR|SQLITE_LOCKED|NETWORK_ERROR|TIMEOUT|HTTP_429|HTTP_502|HTTP_503|HTTP_504)$/.test(
      code,
    ) ||
    /(?:connection reset|connection refused|fetch failed|network|socket|timed? out|temporarily unavailable|rate limit|\b(?:429|502|503|504)\b|\bbusy\b|\blocked\b)/i.test(
      message,
    )
  );
}

function classifyTursoError(error) {
  if (error instanceof AgentHubStoreError) return error;
  return new AgentHubStoreError("Turso Agent Hub write failed", {
    code: "turso_write_failed",
    retryable: isTransientTursoError(error),
    cause: error,
  });
}

function transactionIsOpen(transaction) {
  return transaction && transaction.closed !== true;
}

async function closeAfterFailure(transaction) {
  if (!transactionIsOpen(transaction)) return;
  try {
    await transaction.rollback();
  } catch {
    // The original database error is more useful than a rollback error.
  }
}

function runArguments(run) {
  return [
    run.id,
    run.agent_id,
    jsonValue(run.actions, "actions"),
    run.completed_at,
    run.cost_usd,
    run.created_at,
    run.duration_ms,
    run.error,
    run.log_url,
    jsonValue(run.metadata, "metadata"),
    run.model,
    run.report_date,
    run.run_number,
    run.source_run_id,
    run.started_at,
    run.status,
    run.summary,
    run.tokens_input,
    run.tokens_output,
    run.verdict_severity,
    run.verdict_text,
  ];
}

const databaseWriteQueues = new WeakMap();
const databaseUrlWriteQueues = new Map();

function enqueueWrite(queue, key, operation) {
  const previous = queue.get(key) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  const settled = next.catch(() => undefined);
  queue.set(key, settled);
  void settled.then(() => {
    if (queue.get(key) === settled) queue.delete(key);
  });
  return next;
}

function enqueueDatabaseWrite(database, operation) {
  return enqueueWrite(databaseWriteQueues, database, operation);
}

function enqueueDatabaseUrlWrite(databaseUrl, operation) {
  return enqueueWrite(databaseUrlWriteQueues, databaseUrl, operation);
}

export function createTursoRunStore({ database, databaseUrl }) {
  if (!database || typeof database.transaction !== "function") {
    throw new AgentHubStoreError("a libsql database client is required", {
      code: "agent_hub_configuration",
    });
  }

  const enqueueWriteOperation =
    databaseUrl === undefined
      ? (operation) => enqueueDatabaseWrite(database, operation)
      : (operation) => enqueueDatabaseUrlWrite(databaseUrl, operation);

  async function insertOrGetRun({ agentName, project, sourceRunId, run }) {
    let transaction;
    try {
      transaction = await database.transaction("write");
      const agentResult = await transaction.execute({
        sql: "SELECT id, status FROM agents WHERE name = ? AND project = ? LIMIT 1",
        args: [agentName, project],
      });
      const agent = agentResult.rows[0];
      const agentId = rowValue(agent, "id");
      if (agentId === undefined || agentId === null) {
        throw new AgentHubMissingAgentError(project, agentName);
      }
      if (String(rowValue(agent, "status")) !== "active") {
        throw new AgentHubPausedAgentError(project, agentName);
      }

      const existingResult = await transaction.execute({
        sql: "SELECT id FROM agent_runs WHERE agent_id = ? AND source_run_id = ? LIMIT 1",
        args: [String(agentId), sourceRunId],
      });
      const existingId = rowValue(existingResult.rows[0], "id");
      if (existingId !== undefined && existingId !== null) {
        await transaction.commit();
        return { duplicate: true, run_id: String(existingId) };
      }

      const numberResult = await transaction.execute({
        sql: "SELECT COALESCE(MAX(run_number), 0) + 1 AS run_number FROM agent_runs WHERE agent_id = ?",
        args: [String(agentId)],
      });
      const runNumber = Number(rowValue(numberResult.rows[0], "run_number"));
      if (!Number.isSafeInteger(runNumber) || runNumber < 1) {
        throw new AgentHubStoreError(
          "Agent Hub returned an invalid run number",
          {
            code: "invalid_run_number",
          },
        );
      }

      const storedRun = {
        ...run,
        agent_id: String(agentId),
        run_number: runNumber,
      };
      await transaction.execute({
        sql: `INSERT INTO agent_runs (${RUN_COLUMNS.join(", ")}) VALUES (${RUN_COLUMNS.map(() => "?").join(", ")})`,
        args: runArguments(storedRun),
      });
      await transaction.commit();
      return { duplicate: false, run_id: storedRun.id };
    } catch (error) {
      await closeAfterFailure(transaction);
      throw classifyTursoError(error);
    } finally {
      transaction?.close();
    }
  }

  return {
    insertOrGetRun(args) {
      return enqueueWriteOperation(() => insertOrGetRun(args));
    },
  };
}

export function createTursoAgentHubWriter({
  authToken,
  database,
  databaseUrl,
  env,
  ...writerOptions
} = {}) {
  const environment = env ?? {
    AGENT_HUB_TURSO_AUTH_TOKEN: process.env.AGENT_HUB_TURSO_AUTH_TOKEN,
    AGENT_HUB_TURSO_DATABASE_URL: process.env.AGENT_HUB_TURSO_DATABASE_URL,
  };
  const url =
    databaseUrl ??
    (database
      ? "injected://agent-hub"
      : requiredEnvironment(environment, "AGENT_HUB_TURSO_DATABASE_URL"));
  const token =
    authToken ??
    (database
      ? ""
      : requiredEnvironment(environment, "AGENT_HUB_TURSO_AUTH_TOKEN"));
  const client =
    database ??
    createClient({
      authToken: token,
      timeout: LOCAL_BUSY_TIMEOUT_MS,
      url,
    });
  const queueUrl =
    database === null || database === undefined ? url : undefined;
  return createAgentHubWriter({
    ...writerOptions,
    secrets: [...(writerOptions.secrets ?? []), token],
    store: createTursoRunStore({ database: client, databaseUrl: queueUrl }),
  });
}
