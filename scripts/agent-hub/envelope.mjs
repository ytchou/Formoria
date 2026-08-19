import { createHash } from "node:crypto";

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

export function normalizeAgentRunEnvelope(value) {
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
