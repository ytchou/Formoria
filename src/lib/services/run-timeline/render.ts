import { escapeSlackMrkdwn, truncatePlain } from "@/lib/adapters/slack/blocks";
import { boundedSlackText } from "@/lib/adapters/slack/notification";
import { isoDateInTimeZone } from "@/lib/date-range";
import type { RunEvent, RunEventKind, RunTicket, RunTimeline, TicketOutcome } from "./types";

type SlackBlock = Record<string, unknown>;

const TITLE_LIMIT = 120;
const HEADER_LIMIT = 150;
const MAX_ROWS = 40;
// Headroom under Slack's 3000-char section limit for the "Needs you" heading.
const SECTION_BUDGET = 2_900;
// The compact timeline shares its context element with the run-ID footer.
const COMPACT_BUDGET = 2_500;
// Items listed per bucket; the rest collapse into "… N more".
const MAX_ITEMS = 5;
// An acknowledgement this close to lapsing goes under Needs you.
const ACK_WARN_DAYS = 7;
const DAY_MS = 86_400_000;
// The health agent's logicalDate, which acknowledgement `until` is checked against.
const RUN_TIME_ZONE = "Asia/Taipei";

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

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function utcHHmm(at: number): string {
  const date = new Date(at * 1000);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

type Findings = Extract<RunEvent, { kind: "findings" }>;

function e2eParts(event: Findings): string[] {
  const parts: string[] = [];
  if (event.passed !== undefined) parts.push(`${event.passed} passed`);
  if (event.failed !== undefined) parts.push(`${event.failed} failed`);
  if (event.flaky !== undefined) parts.push(`${event.flaky} flaky`);
  if (event.skipped !== undefined) parts.push(`${event.skipped} skipped`);
  if (event.durationSeconds !== undefined) {
    parts.push(`Duration: ${formatDuration(event.durationSeconds)}`);
  }
  return parts;
}

type KindSpec<K extends RunEventKind> = {
  /** Emoji of the event row, and of the header status when `status` is a string. */
  emoji: string;
  /** Header status text, or the kind whose status this kind shows. */
  status: string | { as: RunEventKind };
  /** Row label; defaults to `status`. */
  label?: (event: Extract<RunEvent, { kind: K }>, startedAt: number | undefined) => string;
  /** Stage name in the compact timeline; null for data-only events. */
  compact: string | null | ((event: Extract<RunEvent, { kind: K }>) => string);
};

const KINDS: { [K in RunEventKind]: KindSpec<K> } = {
  started: { emoji: "🔄", status: "Running", compact: "start" },
  // A findings event always renders as buckets, never as a row.
  findings: { emoji: "🔍", status: "Findings gathered", compact: "findings" },
  repair_requested: { emoji: "📨", status: "Repair requested", compact: "repair" },
  repair_started: {
    emoji: "🔧",
    status: "Repairing",
    compact: "repair",
    label: (event) =>
      event.sessionUrl
        ? `Repair started · <${safeUrl(event.sessionUrl)}|session>`
        : "Repair started",
  },
  repair_failed: {
    emoji: "⚠️",
    status: "Repair failed",
    compact: "repair failed",
    label: (event) => `Repair failed · ${safe(event.reason)}`,
  },
  // A PR or a ticket is progress inside the repair, not a new run state.
  pr_opened: {
    emoji: "🔀",
    status: { as: "repair_started" },
    label: (event) => `PR opened · <${safeUrl(event.url)}|#${event.number}>`,
    compact: (event) => `<${safeUrl(event.url)}|PR #${event.number}>`,
  },
  tickets_filed: {
    emoji: "🎫",
    status: { as: "repair_started" },
    label: (event) => `${plural(event.tickets.length, "ticket")} filed`,
    compact: (event) => plural(event.tickets.length, "ticket"),
  },
  ticket_outcomes: {
    emoji: "🎫",
    status: { as: "findings" },
    label: (event) => plural(event.items.length, "ticket outcome"),
    // Its content is in the buckets.
    compact: null,
  },
  repair_summary: {
    emoji: "📋",
    status: { as: "repair_started" },
    label: (event) => `Repair summary · ${event.fixed} fixed`,
    compact: null,
  },
  completed: {
    emoji: "✅",
    status: "Completed",
    compact: "done",
    label: (event, startedAt) =>
      startedAt === undefined ? "Completed" : `Completed · ${formatDuration(event.at - startedAt)}`,
  },
  failed: {
    emoji: "❌",
    status: "Failed",
    label: (event) =>
      `Failed · ${safe(event.outcome, 40)}${event.reason ? ` · ${safe(event.reason)}` : ""}`,
    compact: (event) => `failed · ${safe(event.outcome, 40)}`,
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
function capRows(rows: string[], budget = SECTION_BUDGET): string[] {
  let max = MAX_ROWS;
  let kept = keepEnds(rows, max);
  while (max > 2 && Array.from(kept.join("\n")).length > budget) {
    max -= 1;
    kept = keepEnds(rows, max);
  }
  return kept;
}

function footerBlock(runId: string, prefix = ""): SlackBlock {
  const footer = `Details in thread ↓ · Run ID: \`${safe(runId, 80).replace(/`/g, "")}\``;
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: boundedSlackText(prefix ? `${prefix} · ${footer}` : footer) }],
  };
}

// ---- Bucket view: the parent once `findings` exists (design D1, D4, D7) ----

type RepairSummary = Extract<RunEvent, { kind: "repair_summary" }>;
type PrOpened = Extract<RunEvent, { kind: "pr_opened" }>;
type RunFailed = Extract<RunEvent, { kind: "failed" }>;

/** Per-bucket state folded from the whole event list. */
type RunFold = {
  findings: Findings;
  e2e: boolean;
  /** Epoch ms of the run's Asia/Taipei date; acknowledgement expiry counts from it. */
  runDay: number;
  prs: PrOpened[];
  /** Tickets the routine filed during the repair. */
  repairTickets: RunTicket[];
  /** Tickets the health agent filed before `ticket_outcomes` existed. */
  legacyTickets: RunTicket[];
  ticketItems: TicketOutcome[];
  autoFixItems: TicketOutcome[];
  repairRequested: boolean;
  repairStarted: boolean;
  sessionUrl?: string;
  repairFailed?: string;
  summary?: RepairSummary;
  completed: boolean;
  failed?: RunFailed;
};

type Bucket = {
  emoji: string;
  name: string;
  /** Lower-case name for the one-line text fallback. */
  short: string;
  count: number;
  /** What happened, after the arrow; absent when nothing is known yet. */
  head?: string;
  details: string[];
};

/** UTC midnight of the Asia/Taipei calendar date of `at`, comparable with a parsed `until`. */
function runDayOf(at: number): number {
  return Date.parse(isoDateInTimeZone(new Date(at * 1000).toISOString(), RUN_TIME_ZONE));
}

function bucketsOf(events: RunEvent[], findings: Findings): RunFold {
  const hasOutcomes = events.some((e) => e.kind === "ticket_outcomes");
  const e2e = findings.passed !== undefined;
  const fold: RunFold = {
    findings,
    e2e,
    runDay: runDayOf(events.find((e) => e.kind === "started")?.at ?? findings.at),
    prs: [],
    repairTickets: [],
    legacyTickets: [],
    ticketItems: [],
    autoFixItems: [],
    repairRequested: false,
    repairStarted: false,
    completed: false,
  };
  for (const event of events) {
    switch (event.kind) {
      case "repair_requested":
        fold.repairRequested = true;
        break;
      case "repair_started":
        fold.repairStarted = true;
        fold.repairFailed = undefined;
        fold.sessionUrl = event.sessionUrl ?? fold.sessionUrl;
        break;
      case "repair_failed":
        fold.repairFailed = event.reason;
        break;
      case "pr_opened":
        // A trigger post that timed out may still have been delivered: later
        // repair evidence supersedes an earlier repair_failed.
        fold.repairFailed = undefined;
        fold.prs.push(event);
        break;
      case "tickets_filed":
        // Before ticket_outcomes the health agent filed its own tickets with this
        // kind, ahead of the repair. It always appends repair_requested before the
        // routine runs; repair_started comes from the routine and can be lost.
        if (!e2e && !hasOutcomes && !fold.repairRequested && !fold.repairStarted) {
          fold.legacyTickets.push(...event.tickets);
        } else {
          fold.repairTickets.push(...event.tickets);
        }
        break;
      case "ticket_outcomes":
        (event.bucket === "auto_fix" ? fold.autoFixItems : fold.ticketItems).push(...event.items);
        break;
      case "repair_summary":
        fold.repairFailed = undefined;
        fold.summary = event;
        break;
      case "completed":
        fold.completed = true;
        break;
      case "failed":
        fold.failed = event;
        break;
      default:
        break;
    }
  }
  return fold;
}

/** "DEV-1, DEV-2" for the tickets whose fix awaits release; empty when none are named. */
function pendingIds(summary: RepairSummary | undefined): string {
  return (summary?.pendingReleaseTickets ?? []).map((id) => safe(id, 20)).join(", ");
}

const isNewTicket = (item: TicketOutcome) => item.outcome === "filed" || item.outcome === "follow_up";

/** "9/29" from an ISO date or timestamp; the raw value when it does not parse. */
function shortDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return safe(iso, 30);
  const date = new Date(ms);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function ticketRef(id: string | undefined, url: string | undefined): string {
  if (!id) return "a ticket";
  return url ? `<${safeUrl(url)}|${safe(id, 20)}>` : safe(id, 20);
}

function prRef(pr: PrOpened): string {
  const ticket = pr.ticketId ? ` (${safe(pr.ticketId, 20)})` : "";
  return `<${safeUrl(pr.url)}|PR #${pr.number}>${ticket}`;
}

/** The routine itself reported in, whatever the trigger step recorded. */
function repairRan(fold: RunFold): boolean {
  return fold.repairStarted || fold.prs.length > 0 || fold.summary !== undefined;
}

function finished(fold: RunFold): boolean {
  return fold.completed || fold.failed !== undefined;
}

/** Where the repair stands, for the bucket that carries it. */
function repairHead(fold: RunFold): string | undefined {
  const n = fold.repairTickets.length;
  const filed = n ? ` · ${plural(n, "ticket")} filed` : "";
  const ran = fold.repairRequested || fold.repairStarted;
  if (fold.repairFailed !== undefined) return `repair failed: ${safe(fold.repairFailed)}${filed}`;
  if (fold.prs.length) return fold.prs.map(prRef).join(", ") + filed;
  if (ran && (fold.summary || finished(fold))) return `no PR${filed}`;
  if (fold.repairStarted) {
    return (fold.sessionUrl ? `repairing (<${safeUrl(fold.sessionUrl)}|session>)` : "repairing") + filed;
  }
  if (fold.repairRequested) return `repair requested${filed}`;
  if (finished(fold)) return `repair not run${filed}`;
  return n ? `${plural(n, "ticket")} filed` : undefined;
}

function repairDetails(fold: RunFold): string[] {
  const summary = fold.summary;
  if (!summary) {
    const ran = fold.repairRequested || fold.repairStarted;
    // An older SKILL.md never sends repair_summary (design risk: hardest to detect).
    return fold.completed && ran && fold.repairFailed === undefined
      ? ["outcome counts not reported"]
      : [];
  }
  const ids = pendingIds(summary);
  const pending =
    summary.pendingRelease > 0
      ? `${summary.pendingRelease} fix pending release${ids ? ` (${ids})` : ""}`
      : "0 pending release";
  const counts = [
    `${summary.fixed} fixed`,
    `${summary.falsePositive} false positive`,
    ...(summary.ticketed ? [`${summary.ticketed} ticketed`] : []),
    pending,
  ].join(" · ");
  // With no PR, a note carrying the compare URL is the only way to the branch.
  const links = fold.prs.length
    ? []
    : (summary.notes ?? []).filter((note) => note.includes("https://")).map((note) => safe(note, 200));
  return [counts, ...links];
}

const OUTCOME_LABELS: Record<TicketOutcome["outcome"], string> = {
  filed: "filed",
  follow_up: "follow-up",
  existing: "existing",
  not_eligible: "not eligible",
  failed: "failed",
  not_processed: "not processed",
};

function outcomeLine(item: TicketOutcome): string {
  const title = safe(item.title);
  const ref = ticketRef(item.ticketId, item.url);
  const reason = item.reason ? `: ${safe(item.reason)}` : "";
  switch (item.outcome) {
    case "filed":
      return `${title}: filed ${ref}`;
    case "follow_up":
      return `${title}: follow-up ${ref}`;
    case "existing": {
      const state = item.state ? safe(item.state, 40) : "state unknown";
      const when = item.ticketedAt ? `, ${shortDate(item.ticketedAt)}` : "";
      const followUp =
        item.closed && item.followUpOn ? `; follow-up allowed ${shortDate(item.followUpOn)}` : "";
      return `${title}: already ${ref} (${state}${when})${followUp}`;
    }
    case "not_eligible":
      return `${title}: not eligible${reason}`;
    case "failed":
      return `${title}: filing failed${reason}`;
    case "not_processed":
      return `${title}: not processed`;
  }
}

/** Per-outcome counts once the list overflows, then the first items. */
function outcomeLines(items: TicketOutcome[]): string[] {
  const listed = items.filter((item) => item.outcome !== "not_processed");
  const lines: string[] = [];
  if (listed.length > MAX_ITEMS) {
    const outcomes = Object.keys(OUTCOME_LABELS) as TicketOutcome["outcome"][];
    const counts = outcomes
      .map((outcome) => [outcome, items.filter((item) => item.outcome === outcome).length] as const)
      .filter(([, n]) => n > 0);
    lines.push(counts.map(([outcome, n]) => `${n} ${OUTCOME_LABELS[outcome]}`).join(" · "));
  }
  lines.push(...listed.slice(0, MAX_ITEMS).map(outcomeLine));
  if (listed.length > MAX_ITEMS) lines.push(`… ${listed.length - MAX_ITEMS} more`);
  return lines;
}

const isUnprocessed = (item: TicketOutcome) => item.outcome === "not_processed";

// Short forms of the reasons the health agent sends; any other reason shows as sent.
const UNPROCESSED_REASONS: Record<string, string> = {
  "ticket ledger read failed": "ledger read failed",
};

/** "not processed (<reasons>)" from the items' own reasons, never an assumed cause. */
function unprocessedLabel(items: TicketOutcome[]): string {
  const short = (reason: string) => UNPROCESSED_REASONS[reason] ?? reason;
  const reasons = [...new Set(items.flatMap((item) => (item.reason ? [short(item.reason)] : [])))];
  return reasons.length
    ? `not processed (${reasons.map((reason) => safe(reason, 60)).join("; ")})`
    : "not processed";
}

function ticketHead(fold: RunFold): string | undefined {
  const items = fold.ticketItems;
  if (items.length) {
    if (items.every(isUnprocessed)) return unprocessedLabel(items);
    const n = items.filter(isNewTicket).length;
    return n ? plural(n, "new ticket") : "no new ticket";
  }
  const legacy = fold.legacyTickets.length;
  return legacy ? `${plural(legacy, "ticket")} filed` : undefined;
}

/** Whole days from the run's date to `until`; undefined when it does not parse. */
function daysLeft(until: string, fold: RunFold): number | undefined {
  const ms = Date.parse(until);
  return Number.isNaN(ms) ? undefined : Math.round((ms - fold.runDay) / DAY_MS);
}

function isExpiring(days: number | undefined): days is number {
  return days !== undefined && days >= 0 && days <= ACK_WARN_DAYS;
}

function ackHead(fold: RunFold): string | undefined {
  const groups = fold.findings.acknowledgedGroups ?? [];
  if (!groups.length) return undefined;
  return groups
    .map((group) => {
      const days = daysLeft(group.until, fold);
      const count = groups.length > 1 ? `${group.count}, ` : "";
      const expiry = isExpiring(days) ? `, ${days === 0 ? "expires today" : `expires in ${days}d`}` : "";
      return `${safe(group.ticket, 20)} (${count}until ${safe(group.until, 30)}${expiry})`;
    })
    .join(", ");
}

function healthBuckets(fold: RunFold): Bucket[] {
  const f = fold.findings;
  const buckets: Bucket[] = [];
  const autoFix = f.autoFix ?? f.repairable ?? 0;
  if (autoFix > 0) {
    const items = fold.autoFixItems;
    // The trigger failed, so the health agent filed the auto-fix tickets itself;
    // later repair evidence means the routine ran after all.
    const fallback = items.length > 0 && !repairRan(fold);
    const fallbackHead = items.every(isUnprocessed)
      ? `repair not run · ${unprocessedLabel(items)}`
      : `repair not run · ${plural(items.filter(isNewTicket).length, "ticket")} filed`;
    buckets.push({
      emoji: "🔧",
      name: "Auto-fix",
      short: "auto-fix",
      count: autoFix,
      head: fallback ? fallbackHead : repairHead(fold),
      details: fallback
        ? [
            ...outcomeLines(items),
            ...(fold.repairFailed !== undefined ? [`repair failed: ${safe(fold.repairFailed)}`] : []),
          ]
        : [...repairDetails(fold), ...outcomeLines(items)],
    });
  }
  const ticket = f.ticket ?? f.reportOnly ?? 0;
  if (ticket > 0) {
    buckets.push({
      emoji: "🎫",
      name: "Ticket",
      short: "ticket",
      count: ticket,
      head: ticketHead(fold),
      details: fold.ticketItems.length
        ? outcomeLines(fold.ticketItems)
        : fold.legacyTickets.map((t) => `${ticketRef(t.id, t.url)} ${safe(t.title)}`),
    });
  }
  if (f.acknowledged) {
    buckets.push({
      emoji: "💤",
      name: "Acknowledged",
      short: "acknowledged",
      count: f.acknowledged,
      head: ackHead(fold),
      details: [],
    });
  }
  return buckets;
}

function e2eBuckets(fold: RunFold): Bucket[] {
  const f = fold.findings;
  const failed = f.failed ?? 0;
  const skips = f.unexpectedSkips ?? 0;
  const flaky = f.flaky ?? 0;
  const buckets: Bucket[] = [];
  if (failed > 0) {
    buckets.push({
      emoji: "❌",
      name: "Failed",
      short: "failed",
      count: failed,
      head: repairHead(fold),
      details: repairDetails(fold),
    });
  }
  if (skips > 0) {
    // One repair covers both; the skips bucket carries it only when nothing failed.
    buckets.push({
      emoji: "⏭️",
      name: "Unexpected skips",
      short: "unexpected skips",
      count: skips,
      head: failed > 0 ? "in the same repair" : repairHead(fold),
      details: failed > 0 ? [] : repairDetails(fold),
    });
  }
  if (flaky > 0) {
    buckets.push({
      emoji: "🔁",
      name: "Flaky",
      short: "flaky",
      count: flaky,
      head: "passed on retry · no action",
      details: [],
    });
  }
  return buckets;
}

function summaryLine(fold: RunFold): string {
  const f = fold.findings;
  const parts: string[] = [];
  if (fold.e2e) {
    parts.push(...e2eParts(f));
  } else {
    if (f.total !== undefined) parts.push(`${f.total} findings`);
    parts.push(
      f.failedDetectors ? `${plural(f.failedDetectors, "detector")} failed` : "all detectors ran",
    );
  }
  // Legacy e2e events carry the unexpected-skip count only in `summary`.
  if (f.summary && f.unexpectedSkips === undefined) parts.push(safe(f.summary));
  return parts.join(" · ");
}

/** Items that need a human action, in the design's D7 order. */
function bucketNeedsRows(fold: RunFold): string[] {
  const rows: string[] = [];
  const items = [...fold.autoFixItems, ...fold.ticketItems];

  for (const pr of fold.prs) rows.push(`• Review ${prRef(pr)}`);

  for (const item of items.filter(isNewTicket)) {
    rows.push(`• Triage ${ticketRef(item.ticketId, item.url)} ${safe(item.title)}`);
  }
  for (const ticket of [...fold.legacyTickets, ...fold.repairTickets]) {
    rows.push(`• Triage ${ticketRef(ticket.id, ticket.url)} ${safe(ticket.title)}`);
  }

  // D6: flag a closed ticket whose finding still fires; never re-file it.
  for (const item of items) {
    if (item.outcome !== "existing" || !item.closed) continue;
    const id = item.ticketId ? safe(item.ticketId, 20) : "Its ticket";
    const state = item.state ? safe(item.state, 40) : "closed";
    const next = item.followUpOn
      ? `reopen, acknowledge, or wait for ${shortDate(item.followUpOn)}`
      : "reopen or acknowledge";
    rows.push(`• ${id} is ${state} but "${safe(item.title)}" still fires: ${next}`);
  }

  for (const note of fold.summary?.notes ?? []) rows.push(`• Repair note: ${safe(note, 200)}`);

  const f = fold.findings;
  if (f.failedDetectorNames?.length) {
    const names = f.failedDetectorNames.map((name) => safe(name, 40)).join(", ");
    rows.push(`• Detectors failed: ${names}; their findings are missing`);
  } else if (f.failedDetectors) {
    rows.push(`• ${plural(f.failedDetectors, "detector")} failed; their findings are missing`);
  }

  for (const group of f.acknowledgedGroups ?? []) {
    if (!isExpiring(daysLeft(group.until, fold))) continue;
    rows.push(
      `• Acknowledgement ${safe(group.ticket, 20)} expires ${safe(group.until, 30)}: ` +
        `${plural(group.count, "finding")} will route again`,
    );
  }

  const pending = fold.summary?.pendingRelease ?? 0;
  if (pending > 0) {
    const ids = pendingIds(fold.summary);
    rows.push(`• Promote staging to clear ${plural(pending, "finding")}${ids ? ` (${ids})` : ""}`);
  }

  // The fallback bucket already reports a failed trigger through its tickets;
  // unprocessed items are no tickets, so the re-send row still applies.
  if (fold.repairFailed !== undefined && fold.autoFixItems.every(isUnprocessed)) {
    rows.push("• Repair failed: findings re-send tomorrow");
  }
  if (fold.failed) {
    const reason = fold.failed.reason ? ` · ${safe(fold.failed.reason)}` : "";
    rows.push(`• Run failed: ${safe(fold.failed.outcome, 40)}${reason}`);
  }
  const unprocessed = items.filter(isUnprocessed).length;
  if (unprocessed) rows.push(`• Ticket step skipped: ${plural(unprocessed, "finding")} unticketed`);
  for (const item of items) {
    if (item.outcome === "failed") rows.push(`• Ticket filing failed for "${safe(item.title)}"`);
  }
  return rows;
}

/** Short stage name for the compact timeline; null for data-only events. */
function compactLabel(event: RunEvent): string | null {
  // Correlated-union cast, as in eventRow.
  const { compact } = KINDS[event.kind] as KindSpec<RunEventKind>;
  return typeof compact === "function" ? compact(event) : compact;
}

function compactTimeline(events: RunEvent[]): string {
  const parts: string[] = [];
  let previous: string | null = null;
  for (const event of events) {
    const label = compactLabel(event);
    // Consecutive stages with one name (repair requested → started) read as one.
    if (label === null || label === previous) continue;
    previous = label;
    parts.push(`<!date^${event.at}^{time}|${utcHHmm(event.at)}> ${label}`);
  }
  return capRows(parts, COMPACT_BUDGET).join(" · ");
}

/** Link markup to its label, for the plain-text notification fallback. */
function plainText(mrkdwn: string): string {
  return mrkdwn.replace(/<[^<>|]*\|([^<>]*)>/g, "$1");
}

function renderBuckets(
  timeline: RunTimeline,
  findings: Findings,
  headline: string,
): { text: string; blocks: SlackBlock[] } {
  const fold = bucketsOf(timeline.events, findings);
  const buckets = fold.e2e ? e2eBuckets(fold) : healthBuckets(fold);
  const summary = summaryLine(fold);

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: truncatePlain(headline, HEADER_LIMIT), emoji: true },
    },
    { type: "section", text: { type: "mrkdwn", text: boundedSlackText(summary) } },
  ];

  // One section per bucket keeps each under Slack's 3000-char limit.
  for (const bucket of buckets) {
    const line = `${bucket.emoji} ${bucket.name} · ${bucket.count}${bucket.head ? ` → ${bucket.head}` : ""}`;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: boundedSlackText([line, ...bucket.details.map((d) => `   ${d}`)].join("\n")),
      },
    });
  }

  const needs = bucketNeedsRows(fold);
  if (needs.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: boundedSlackText(`*Needs you*\n${capRows(needs).join("\n")}`) },
    });
  }

  blocks.push(footerBlock(timeline.runId, compactTimeline(timeline.events)));

  const oneLiners = buckets.map(
    (b) => `${b.count} ${b.short}${b.head ? ` → ${plainText(b.head)}` : ""}`,
  );
  const text = noFence([headline, oneLiners.length ? oneLiners.join(" · ") : summary].join(" · "));
  return { text, blocks };
}

export function renderTimeline(timeline: RunTimeline): { text: string; blocks: SlackBlock[] } {
  const { events } = timeline;
  const title = truncatePlain(noFence(timeline.title).replace(/\s+/g, " ").trim(), TITLE_LIMIT);
  const latest = events[events.length - 1];
  const status = statusFor(latest);
  const startedAt = events.find((e) => e.kind === "started")?.at;

  const findings = events.find((e): e is Findings => e.kind === "findings");
  if (findings) {
    const duration =
      latest?.kind === "completed" && startedAt !== undefined
        ? ` · ${formatDuration(latest.at - startedAt)}`
        : "";
    return renderBuckets(timeline, findings, `${title} · ${status}${duration}`);
  }

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

  blocks.push(footerBlock(timeline.runId));

  const lastRow = rendered[rendered.length - 1]?.plain;
  const text = noFence([`${title} · ${status}`, lastRow].filter(Boolean).join("\n"));

  return { text, blocks };
}
