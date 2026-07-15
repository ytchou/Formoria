import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SOURCES = new Set(["claude_routine", "github_actions"]);
const STATUSES = new Set(["success", "failed", "skipped"]);
const SEVERITIES = new Set(["ok", "info", "warning", "critical", "error"]);

export class AgentHubReportError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "AgentHubReportError";
    this.status = status;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value, field, maxLength) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new AgentHubReportError(`${field} is invalid`);
  }
  return value;
}

function taipeiDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Taipei",
    year: "numeric",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function derivedSourceRunId(project, routine, runAt) {
  const digest = createHash("sha256")
    .update(`${project}\n${routine}\n${runAt}`)
    .digest("hex")
    .slice(0, 24);
  return `claude-routine:${routine}:${digest}`;
}

export function normalizeRoutineEnvelope(value) {
  if (!isRecord(value))
    throw new AgentHubReportError("routine envelope must be a JSON object");
  const project = requireString(value.project, "project", 100);
  if (project !== "formoria")
    throw new AgentHubReportError("project is not authorized");
  const routine = requireString(value.routine, "routine", 100);
  const runAt = requireString(value.run_at, "run_at", 100);
  const date = requireString(value.date, "date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new AgentHubReportError("date is invalid");
  if (taipeiDate(runAt) === null)
    throw new AgentHubReportError("run_at is invalid");
  if (taipeiDate(runAt) !== date)
    throw new AgentHubReportError("date must match run_at in Asia/Taipei");

  const source = value.source ?? "claude_routine";
  if (!SOURCES.has(source)) throw new AgentHubReportError("source is invalid");
  const sourceRunId =
    value.source_run_id ??
    (source === "claude_routine"
      ? derivedSourceRunId(project, routine, runAt)
      : null);
  requireString(sourceRunId, "source_run_id", 200);
  if (value.version !== undefined && value.version !== 1)
    throw new AgentHubReportError("version must be 1");
  if (!STATUSES.has(value.status))
    throw new AgentHubReportError("status is invalid");
  if (!SEVERITIES.has(value.verdict_severity))
    throw new AgentHubReportError("verdict_severity is invalid");
  const verdictText = requireString(value.verdict_text, "verdict_text", 1_000);
  const tickets = value.tickets_created ?? [];
  if (
    !Array.isArray(tickets) ||
    tickets.length > 50 ||
    !tickets.every(
      (ticket) =>
        typeof ticket === "string" &&
        ticket.trim().length > 0 &&
        ticket.length <= 100,
    )
  ) {
    throw new AgentHubReportError("tickets_created is invalid");
  }
  if (!isRecord(value.data))
    throw new AgentHubReportError("data must be a JSON object");
  if (value.log_url !== undefined && value.log_url !== null) {
    let url;
    try {
      url = new URL(value.log_url);
    } catch {
      throw new AgentHubReportError("log_url is invalid");
    }
    if (!["https:", "http:"].includes(url.protocol))
      throw new AgentHubReportError("log_url is invalid");
  }

  return {
    data: value.data,
    date,
    ...(value.log_url ? { log_url: value.log_url } : {}),
    project,
    routine,
    run_at: runAt,
    source,
    source_run_id: sourceRunId,
    status: value.status,
    tickets_created: tickets,
    verdict_severity: value.verdict_severity,
    verdict_text: verdictText,
    version: 1,
  };
}

function responseBody(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 1_000) };
  }
}

function shouldRetry(status) {
  return status === 429 || status >= 500;
}

export async function reportAgentRun(
  input,
  {
    fetchImplementation = fetch,
    logger = (record) => console.log(JSON.stringify(record)),
    maxAttempts = 3,
    sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMs = 15_000,
    token = process.env.AGENT_HUB_INGEST_TOKEN,
    url = process.env.AGENT_HUB_INGEST_URL,
  } = {},
) {
  const payload = normalizeRoutineEnvelope(input);
  requireString(url, "AGENT_HUB_INGEST_URL", 2_048);
  requireString(token, "AGENT_HUB_INGEST_TOKEN", 1_000);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new AgentHubReportError("maxAttempts is invalid");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = performance.now();
    try {
      const response = await fetchImplementation(url, {
        body: JSON.stringify(payload),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-request-id": crypto.randomUUID(),
        },
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = responseBody(await response.text());
      logger({
        attempt,
        event: "agent_hub_report",
        latency_ms: Math.round(performance.now() - startedAt),
        request: payload,
        response: body,
        status: response.status,
      });
      if (response.ok) {
        if (
          !isRecord(body) ||
          typeof body.run_id !== "string" ||
          typeof body.duplicate !== "boolean"
        ) {
          throw new AgentHubReportError(
            "Agent Hub returned an invalid response",
            response.status,
          );
        }
        return body;
      }
      if (!shouldRetry(response.status) || attempt === maxAttempts) {
        const message =
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "Agent Hub rejected the run";
        throw new AgentHubReportError(message, response.status);
      }
    } catch (error) {
      if (error instanceof AgentHubReportError) throw error;
      logger({
        attempt,
        event: "agent_hub_report",
        latency_ms: Math.round(performance.now() - startedAt),
        request: payload,
        response: {
          error: error instanceof Error ? error.message : String(error),
        },
        status: 0,
      });
      if (attempt === maxAttempts)
        throw new AgentHubReportError("Agent Hub request failed");
    }
    await sleep(250 * 2 ** (attempt - 1));
  }

  throw new AgentHubReportError("Agent Hub request failed");
}

function fileArgument(argv) {
  const index = argv.indexOf("--file");
  return index >= 0 ? argv[index + 1] : null;
}

export async function main(argv = process.argv.slice(2)) {
  const file = fileArgument(argv);
  if (!file)
    throw new AgentHubReportError(
      "Usage: node scripts/agent-hub/report-run.mjs --file <envelope.json>",
    );
  const envelope = JSON.parse(await readFile(file, "utf8"));
  const result = await reportAgentRun(envelope);
  console.log(
    JSON.stringify({ event: "agent_hub_delivery_complete", ...result }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({ error: message, event: "agent_hub_delivery_failed" }),
    );
    process.exitCode = 1;
  });
}
