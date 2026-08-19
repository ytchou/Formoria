import { randomUUID } from "node:crypto";

import { AgentHubReportError, normalizeAgentRunEnvelope } from "./envelope.mjs";

const SENSITIVE_KEY =
  /(?:token|secret|password|authorization|api[_-]?key|credential)/i;
const TRANSIENT_ERROR_CODE =
  /^(?:ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|SQLITE_BUSY|SQLITE_BUSY_SNAPSHOT|SQLITE_IOERR|SQLITE_LOCKED|NETWORK_ERROR|TIMEOUT|HTTP_429|HTTP_502|HTTP_503|HTTP_504)$/;
const TRANSIENT_ERROR_MESSAGE =
  /(?:connection reset|connection refused|fetch failed|network|socket|timed? out|temporarily unavailable|rate limit|\b(?:429|502|503|504)\b|\bbusy\b|\blocked\b)/i;
const DEFAULT_MAX_ATTEMPTS = 5;

export class AgentHubStoreError extends Error {
  constructor(
    message,
    { code = "agent_hub_store_error", retryable = false, cause } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "AgentHubStoreError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class AgentHubMissingAgentError extends AgentHubStoreError {
  constructor(project, routine) {
    super(`active agent not found for ${project}/${routine}`, {
      code: "agent_not_found",
    });
    this.name = "AgentHubMissingAgentError";
  }
}

export class AgentHubPausedAgentError extends AgentHubStoreError {
  constructor(project, routine) {
    super(`agent is not active for ${project}/${routine}`, {
      code: "agent_not_active",
    });
    this.name = "AgentHubPausedAgentError";
  }
}

export class AgentHubWriterConfigurationError extends AgentHubStoreError {
  constructor(message) {
    super(message, { code: "agent_hub_configuration" });
    this.name = "AgentHubWriterConfigurationError";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactedString(value, secrets) {
  let result = String(value).slice(0, 2_000);
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join("[REDACTED]");
  }
  return result
    .replace(
      /(token|secret|password|authorization)\s*[:=]\s*\S+/gi,
      "$1=[REDACTED]",
    )
    .replace(/https?:\/\/\S+/gi, (url) => {
      try {
        const parsed = new URL(url);
        for (const key of parsed.searchParams.keys()) {
          if (SENSITIVE_KEY.test(key))
            parsed.searchParams.set(key, "[REDACTED]");
        }
        return parsed.toString();
      } catch {
        return "[REDACTED_URL]";
      }
    });
}

export function redactAgentHubAudit(value, secrets = [], depth = 0) {
  if (depth > 6) return "[REDACTED_DEPTH]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return redactedString(value, secrets);
  if (Array.isArray(value)) {
    return value
      .slice(0, 200)
      .map((item) => redactAgentHubAudit(item, secrets, depth + 1));
  }
  if (typeof value !== "object") return redactedString(value, secrets);

  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? "[REDACTED]"
      : redactAgentHubAudit(item, secrets, depth + 1);
  }
  return result;
}

function safeErrorMessage(error, secrets) {
  return redactedString(
    error instanceof Error ? error.message : error,
    secrets,
  );
}

function isTransientError(error) {
  if (error && error.retryable === true) return true;
  if (!(error instanceof Error) && !isRecord(error)) return false;
  const code = String(error.code ?? "").toUpperCase();
  return (
    TRANSIENT_ERROR_CODE.test(code) ||
    TRANSIENT_ERROR_MESSAGE.test(error.message ?? "")
  );
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function usageValue(data, key, aliases = []) {
  const usage = isRecord(data.model_usage) ? data.model_usage : {};
  for (const candidate of [
    data[key],
    usage[key],
    ...aliases.map((alias) => usage[alias]),
  ]) {
    if (candidate !== undefined && candidate !== null) return candidate;
  }
  return null;
}

function utcIso(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AgentHubReportError(`${field} is invalid`);
  }
  return date.toISOString();
}

function buildRunPayload(payload, now) {
  const startedAt = utcIso(payload.run_at, "run_at");
  const completedAt = utcIso(now(), "completed_at");
  const durationMs = Math.max(
    0,
    Math.round(Date.parse(completedAt) - Date.parse(startedAt)),
  );
  const metadata = { ...payload.data, source: payload.source };

  try {
    JSON.stringify(metadata);
  } catch {
    throw new AgentHubReportError("data must be JSON serializable");
  }

  return {
    id: randomUUID(),
    actions: payload.tickets_created.map((ticket) => ({
      desc: `Created Linear issue ${ticket}`,
      path: ticket,
      type: "linear_issue",
    })),
    completed_at: completedAt,
    cost_usd: numberOrNull(usageValue(payload.data, "cost_usd")),
    created_at: completedAt,
    duration_ms: durationMs,
    error: stringOrNull(payload.data.error),
    log_url: payload.log_url ?? null,
    metadata,
    model: stringOrNull(usageValue(payload.data, "model")),
    report_date: payload.date,
    source_run_id: payload.source_run_id,
    started_at: startedAt,
    status: payload.status,
    summary: payload.verdict_text,
    tokens_input: numberOrNull(
      usageValue(payload.data, "tokens_input", ["input_tokens"]),
    ),
    tokens_output: numberOrNull(
      usageValue(payload.data, "tokens_output", ["output_tokens"]),
    ),
    verdict_severity: payload.verdict_severity,
    verdict_text: payload.verdict_text,
  };
}

function auditRecord(
  { attempt, latencyMs, request, response, status },
  secrets,
) {
  return {
    attempt,
    event: "agent_hub_write",
    latency_ms: latencyMs,
    operation: "insert_agent_run",
    request: redactAgentHubAudit(request, secrets),
    response: redactAgentHubAudit(response, secrets),
    status,
    success: status === "success",
  };
}

function validateWriterOptions({ maxAttempts }) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new AgentHubWriterConfigurationError("maxAttempts is invalid");
  }
}

export async function writeAgentRun(
  input,
  {
    normalizeInput = true,
    store,
    logger = (record) => console.log(JSON.stringify(record)),
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    now = () => new Date(),
    secrets = [],
    sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {},
) {
  validateWriterOptions({ maxAttempts });
  if (!store || typeof store.insertOrGetRun !== "function") {
    throw new AgentHubWriterConfigurationError(
      "an Agent Hub database boundary is required",
    );
  }

  const validationStartedAt = performance.now();
  let payload;
  let run;
  try {
    payload = normalizeInput ? normalizeAgentRunEnvelope(input) : input;
    run = buildRunPayload(payload, now);
  } catch (error) {
    logger(
      auditRecord(
        {
          attempt: 1,
          latencyMs: Math.round(performance.now() - validationStartedAt),
          request: { envelope: input },
          response: { error: safeErrorMessage(error, secrets) },
          status: "failure",
        },
        secrets,
      ),
    );
    throw error;
  }

  const request = {
    project: payload.project,
    routine: payload.routine,
    source_run_id: payload.source_run_id,
    run,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = performance.now();
    try {
      const result = await store.insertOrGetRun({
        agentName: payload.routine,
        project: payload.project,
        sourceRunId: payload.source_run_id,
        run,
      });
      if (
        !isRecord(result) ||
        typeof result.run_id !== "string" ||
        typeof result.duplicate !== "boolean"
      ) {
        throw new AgentHubStoreError(
          "Agent Hub returned an invalid write result",
          {
            code: "invalid_write_result",
          },
        );
      }
      logger(
        auditRecord(
          {
            attempt,
            latencyMs: Math.round(performance.now() - startedAt),
            request,
            response: result,
            status: "success",
          },
          secrets,
        ),
      );
      return result;
    } catch (error) {
      const retryable = isTransientError(error);
      logger(
        auditRecord(
          {
            attempt,
            latencyMs: Math.round(performance.now() - startedAt),
            request,
            response: {
              error: safeErrorMessage(error, secrets),
              retryable,
            },
            status: "failure",
          },
          secrets,
        ),
      );
      if (!retryable || attempt === maxAttempts) throw error;
    }
    await sleep(250 * 2 ** (attempt - 1));
  }

  throw new AgentHubStoreError("Agent Hub write failed");
}

export function createAgentHubWriter(options) {
  return (input) => writeAgentRun(input, options);
}
