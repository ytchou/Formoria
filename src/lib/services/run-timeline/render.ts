import { escapeSlackMrkdwn, truncatePlain } from "@/lib/adapters/slack/blocks";
import { boundedSlackText } from "@/lib/adapters/slack/notification";
import type { RunEvent, RunEventKind, RunTimeline } from "./types";

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

/** Payload string for a mrkdwn context: fence-free, single-line, escaped, bounded. */
function safe(text: string, limit = TITLE_LIMIT): string {
  return escapeSlackMrkdwn(truncatePlain(noFence(text).replace(/\s+/g, " ").trim(), limit));
}

/** URL for a `<url|label>` link: strips characters that would break the link syntax. */
function safeUrl(url: string): string {
  return noFence(url).replace(/[<>|\s]/g, "");
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  // Same "Xm Ys" form as the e2e agent's summary duration.
  if (minutes < 60) return `${minutes}m ${s % 60}s`;
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

type KindSpec<K extends RunEventKind> = {
  /** Emoji of the event row, and of the header status when `status` is a string. */
  emoji: string;
  /** Header status text, or the kind whose status this kind shows. */
  status: string | { as: RunEventKind };
  /** Row label; defaults to `status`. */
  label?: (event: Extract<RunEvent, { kind: K }>, startedAt: number | undefined) => string;
};

const KINDS: { [K in RunEventKind]: KindSpec<K> } = {
  started: { emoji: "🔄", status: "Running" },
  findings: { emoji: "🔍", status: "Findings gathered", label: findingsLabel },
  repair_requested: { emoji: "📨", status: "Repair requested" },
  repair_started: {
    emoji: "🔧",
    status: "Repairing",
    label: (event) =>
      event.sessionUrl
        ? `Repair started · <${safeUrl(event.sessionUrl)}|session>`
        : "Repair started",
  },
  repair_failed: {
    emoji: "⚠️",
    status: "Repair failed",
    label: (event) => `Repair failed · ${safe(event.reason)}`,
  },
  // A PR or a ticket is progress inside the repair, not a new run state.
  pr_opened: {
    emoji: "🔀",
    status: { as: "repair_started" },
    label: (event) => `PR opened · <${safeUrl(event.url)}|#${event.number}>`,
  },
  tickets_filed: {
    emoji: "🎫",
    status: { as: "repair_started" },
    label: (event) => {
      const n = event.tickets.length;
      return `${n} ticket${n === 1 ? "" : "s"} filed`;
    },
  },
  completed: {
    emoji: "✅",
    status: "Completed",
    label: (event, startedAt) =>
      startedAt === undefined ? "Completed" : `Completed · ${formatDuration(event.at - startedAt)}`,
  },
  failed: {
    emoji: "❌",
    status: "Failed",
    label: (event) =>
      `Failed · ${safe(event.outcome, 40)}${event.reason ? ` · ${safe(event.reason)}` : ""}`,
  },
};

function statusText(kind: RunEventKind): string {
  const { emoji, status } = KINDS[kind];
  return typeof status === "string" ? `${emoji} ${status}` : statusText(status.as);
}

function statusFor(event: RunEvent | undefined): string {
  if (event?.kind === "failed") {
    return `${statusText("failed")} · ${truncatePlain(noFence(event.outcome), 40)}`;
  }
  return statusText(event?.kind ?? "started");
}

function eventRow(event: RunEvent, startedAt: number | undefined): { emoji: string; label: string } {
  // Correlated-union cast: KINDS[event.kind] is the spec for this event's kind.
  const spec = KINDS[event.kind] as KindSpec<RunEventKind>;
  const label = spec.label ? spec.label(event, startedAt) : String(spec.status);
  return { emoji: spec.emoji, label };
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

/** Keeps the first and the last rows; the newest row is always kept. */
function keepEnds(rows: string[], max: number): string[] {
  if (rows.length <= max) return rows;
  const head = Math.max(0, Math.min(Math.ceil(max / 2), max - 2));
  const tail = Math.max(1, max - head - 1);
  const omitted = rows.length - head - tail;
  return [
    ...rows.slice(0, head),
    `… ${omitted} rows omitted …`,
    ...rows.slice(rows.length - tail),
  ];
}

/**
 * Keeps the first and the last rows and drops the middle, so the section stays
 * under Slack's 3000-char limit without losing the latest events. At the floor
 * (max 2) only the omitted marker and the newest row remain.
 */
function capRows(rows: string[]): string[] {
  let max = MAX_ROWS;
  let kept = keepEnds(rows, max);
  while (max > 2 && Array.from(kept.join("\n")).length > SECTION_BUDGET) {
    max -= 1;
    kept = keepEnds(rows, max);
  }
  return kept;
}

export function renderTimeline(timeline: RunTimeline): { text: string; blocks: SlackBlock[] } {
  const { events } = timeline;
  const title = truncatePlain(noFence(timeline.title).replace(/\s+/g, " ").trim(), TITLE_LIMIT);
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
        text: truncatePlain(`${title} · ${status}`, HEADER_LIMIT),
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
