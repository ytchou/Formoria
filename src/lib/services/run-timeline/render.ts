import { boundedSlackText } from "@/lib/adapters/slack/notification";
import type { RunEvent, RunTimeline } from "./types";

type SlackBlock = Record<string, unknown>;

const TITLE_LIMIT = 120;
const HEADER_LIMIT = 150;
const MAX_ROWS = 40;
// Headroom under Slack's 3000-char section limit for the "Needs you" heading.
const SECTION_BUDGET = 2_900;

// Bot messages containing a ```json fence are treated as repair requests by the
// Slack events route, so no fence may ever leave this renderer.
function noFence(text: string): string {
  return text.replace(/`{3,}/g, (run) => run.split("").join("\u200b"));
}

function truncate(text: string, limit: number): string {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  return characters.slice(0, limit - 1).join("") + "…";
}

/** Payload string for a mrkdwn context: fence-free, single-line, escaped, bounded. */
function safe(text: string, limit = TITLE_LIMIT): string {
  return truncate(noFence(text).replace(/\s+/g, " ").trim(), limit)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** URL for a `<url|label>` link: strips characters that would break the link syntax. */
function safeUrl(url: string): string {
  return noFence(url).replace(/[<>|\s]/g, "");
}

function statusFor(event: RunEvent | undefined): string {
  switch (event?.kind) {
    case undefined:
    case "started":
      return "🔄 Running";
    case "findings":
      return "🔍 Findings gathered";
    case "repair_requested":
      return "📨 Repair requested";
    case "repair_started":
    case "pr_opened":
    case "tickets_filed":
      return "🔧 Repairing";
    case "repair_failed":
      return "⚠️ Repair failed";
    case "completed":
      return "✅ Completed";
    case "failed":
      return `❌ Failed · ${truncate(noFence(event.outcome), 40)}`;
  }
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function utcHHmm(at: number): string {
  const date = new Date(at * 1000);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function findingsLabel(event: Extract<RunEvent, { kind: "findings" }>): string {
  const parts: string[] = [];
  if (event.total !== undefined) parts.push(`${event.total} findings`);
  if (event.repairable !== undefined) parts.push(`${event.repairable} repairable`);
  if (event.reportOnly !== undefined) parts.push(`${event.reportOnly} report-only`);
  if (event.passed !== undefined) parts.push(`${event.passed} passed`);
  if (event.failed !== undefined) parts.push(`${event.failed} failed`);
  if (event.flaky !== undefined) parts.push(`${event.flaky} flaky`);
  if (event.summary) parts.push(safe(event.summary));
  return parts.length ? parts.join(" · ") : "Findings gathered";
}

function eventRow(event: RunEvent, startedAt: number | undefined): { emoji: string; label: string } {
  switch (event.kind) {
    case "started":
      return { emoji: "🔄", label: "Running" };
    case "findings":
      return { emoji: "🔍", label: findingsLabel(event) };
    case "repair_requested":
      return { emoji: "📨", label: "Repair requested" };
    case "repair_started":
      return {
        emoji: "🔧",
        label: event.sessionUrl
          ? `Repair started · <${safeUrl(event.sessionUrl)}|session>`
          : "Repair started",
      };
    case "repair_failed":
      return { emoji: "⚠️", label: `Repair failed · ${safe(event.reason)}` };
    case "pr_opened":
      return { emoji: "🔀", label: `PR opened · <${safeUrl(event.url)}|#${event.number}>` };
    case "tickets_filed": {
      const n = event.tickets.length;
      return { emoji: "🎫", label: `${n} ticket${n === 1 ? "" : "s"} filed` };
    }
    case "completed":
      return {
        emoji: "✅",
        label:
          startedAt === undefined
            ? "Completed"
            : `Completed · ${formatDuration(event.at - startedAt)}`,
      };
    case "failed":
      return {
        emoji: "❌",
        label: `Failed · ${safe(event.outcome, 40)}${event.reason ? ` · ${safe(event.reason)}` : ""}`,
      };
  }
}

function needsYouRows(events: RunEvent[]): string[] {
  const rows: string[] = [];
  for (const event of events) {
    if (event.kind === "pr_opened") {
      const prefix = event.ticketId ? `${safe(event.ticketId, 20)} · ` : "";
      rows.push(
        `• ${prefix}Review PR <${safeUrl(event.url)}|#${event.number}>: ${safe(event.title)}`,
      );
    } else if (event.kind === "tickets_filed") {
      for (const ticket of event.tickets) {
        rows.push(`• <${safeUrl(ticket.url)}|${safe(ticket.id, 20)}> ${safe(ticket.title)}`);
      }
    }
  }
  return rows;
}

function keepEnds(rows: string[], max: number): string[] {
  if (rows.length <= max) return rows;
  const head = Math.ceil(max / 2);
  const tail = max - head - 1;
  const omitted = rows.length - head - tail;
  return [
    ...rows.slice(0, head),
    `… ${omitted} rows omitted …`,
    ...rows.slice(rows.length - tail),
  ];
}

/**
 * Keeps the first and the last rows and drops the middle, so the section stays
 * under Slack's 3000-char limit without losing the latest events.
 */
function capRows(rows: string[]): string[] {
  let max = MAX_ROWS;
  let kept = keepEnds(rows, max);
  while (max > 3 && Array.from(kept.join("\n")).length > SECTION_BUDGET) {
    max -= 1;
    kept = keepEnds(rows, max);
  }
  return kept;
}

export function renderTimeline(timeline: RunTimeline): { text: string; blocks: SlackBlock[] } {
  const { events } = timeline;
  const title = truncate(noFence(timeline.title).replace(/\s+/g, " ").trim(), TITLE_LIMIT);
  const latest = events[events.length - 1];
  const status = statusFor(latest);
  const startedAt = events.find((e) => e.kind === "started")?.at;

  const rendered = events.map((event) => {
    const { emoji, label } = eventRow(event, startedAt);
    return {
      row: `<!date^${event.at}^{time}|${utcHHmm(event.at)}>  ${emoji}  ${label}`,
      plain: `${utcHHmm(event.at)} ${label}`,
    };
  });

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncate(`${title} · ${status}`, HEADER_LIMIT),
        emoji: true,
      },
    },
  ];

  if (rendered.length) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: boundedSlackText(capRows(rendered.map((r) => r.row)).join("\n")),
      },
    });
  }

  const needs = needsYouRows(events);
  if (needs.length) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: boundedSlackText(`*Needs you*\n${capRows(needs).join("\n")}`),
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Details in thread ↓ · \`${safe(timeline.runId, 80).replace(/`/g, "")}\``,
      },
    ],
  });

  const lastRow = rendered[rendered.length - 1]?.plain;
  const text = noFence([`${title} · ${status}`, lastRow].filter(Boolean).join("\n"));

  return { text, blocks };
}
