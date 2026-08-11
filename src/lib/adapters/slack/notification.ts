/**
 * Slack notification rendering.
 *
 * Moved here from `scripts/health-agent/adapters.ts` so that `src/lib` code can
 * post to Slack without importing from `scripts/` (which would invert the
 * dependency direction). `scripts/health-agent/adapters.ts` re-exports these,
 * so the GitHub Actions path (`scripts/notifications/e2e-slack.ts`) is
 * unchanged.
 */

export type AgentNotificationStatus = "failed" | "needs_attention" | "success";

export interface AgentNotification {
  agent: string;
  // Run date, already formatted (YYYY-MM-DD, Asia/Taipei by project
  // convention). Rendered after the status so a scrollback of green
  // notifications stays attributable to a day without hovering timestamps.
  date?: string;
  details?: readonly string[];
  failedSpecs?: readonly string[];
  managerAction?: string;
  pullRequestLabel?: string;
  pullRequestUrl?: string;
  status: AgentNotificationStatus;
  summary: readonly string[];
  workDone?: readonly string[];
  workflowUrl?: string;
}

const SLACK_TEXT_LIMIT = 2_999;

export function boundedSlackText(text: string): string {
  const characters = Array.from(text);
  if (characters.length <= SLACK_TEXT_LIMIT) return text;
  const suffix = "\n…summary truncated; open the workflow run for details";
  return (
    characters.slice(0, SLACK_TEXT_LIMIT - Array.from(suffix).length).join("") +
    suffix
  );
}

function notificationStatusLabel(status: AgentNotificationStatus): string {
  return status === "success"
    ? "Success"
    : status === "needs_attention"
      ? "Needs attention"
      : "Failed";
}

function notificationStatusEmoji(status: AgentNotificationStatus): string {
  return status === "success"
    ? "✅"
    : status === "needs_attention"
      ? "⚠️"
      : "❌";
}

export function renderAgentNotification(input: AgentNotification): string {
  const date = input.date?.trim();
  const sections = [
    `${notificationStatusEmoji(input.status)} *Formoria ${input.agent} — ${notificationStatusLabel(input.status)}*${date ? ` · ${date}` : ""}`,
    `*Summary*\n${input.summary.join("\n")}`,
  ];
  if (input.workDone && input.workDone.length > 0) {
    sections.push(`*Work done*\n${input.workDone.join("\n")}`);
  }
  if (input.failedSpecs && input.failedSpecs.length > 0) {
    sections.push(`*Failed specs*\n${input.failedSpecs.join("\n")}`);
  }
  if (input.pullRequestUrl) {
    sections.push(
      `*${input.pullRequestLabel ?? "Pull request"}*\n<${input.pullRequestUrl}|Open PR>`,
    );
  }
  if (input.managerAction) {
    sections.push(`*Manager action*\n• ${input.managerAction}`);
  }
  if (input.details && input.details.length > 0) {
    sections.push(`*Details*\n${input.details.join("\n")}`);
  }
  if (input.workflowUrl) {
    sections.push(`<${input.workflowUrl}|Open workflow run>`);
  }
  return sections.join("\n\n");
}
