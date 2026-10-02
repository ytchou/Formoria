import { describe, expect, it } from "vitest";
import { renderTimeline } from "../render";
import type { RunEvent, RunTimeline } from "../types";

const T0 = 1_758_700_000; // epoch seconds
const PR_URL = "https://github.com/ytchou/Formoria/pull/1252";
const TICKET_URL = "https://linear.app/ytchou/issue/DEV-2041";

function timeline(events: RunEvent[], title = "Health agent · nightly"): RunTimeline {
  return { agent: "health", title, runId: "run-abc", events };
}

function headerText(blocks: Array<Record<string, unknown>>): string {
  const header = blocks.find((b) => b.type === "header") as { text: { text: string } };
  return header.text.text;
}

type Rendered = { text: string; blocks: Array<Record<string, unknown>> };

function allText(result: Rendered): string {
  return result.text + JSON.stringify(result.blocks);
}

/** Text as Slack shows it: links and date tokens collapse to their labels. */
function visible(text: string): string {
  return text
    .replace(/<!date\^\d+\^\{time\}\|([^>]*)>/g, "$1")
    .replace(/<[^<>|]+\|([^<>]*)>/g, "$1");
}

function sectionTexts(result: Rendered): string[] {
  return result.blocks
    .filter((b) => b.type === "section")
    .map((b) => (b as { text: { text: string } }).text.text);
}

/** Every visible line of every section, trimmed. */
function sectionLines(result: Rendered): string[] {
  return sectionTexts(result).flatMap((t) => visible(t).split("\n").map((l) => l.trim()));
}

/** Visible Needs you rows without their bullets; empty when the section is absent. */
function needsYou(result: Rendered): string[] {
  const section = sectionTexts(result).find((t) => t.startsWith("*Needs you*"));
  if (!section) return [];
  return visible(section)
    .split("\n")
    .slice(1)
    .map((l) => l.replace(/^• /, ""));
}

function contextText(result: Rendered): string {
  const last = result.blocks[result.blocks.length - 1] as {
    type: string;
    elements: Array<{ text: string }>;
  };
  expect(last.type).toBe("context");
  return last.elements[0]!.text;
}

describe("renderTimeline status", () => {
  const cases: Array<[RunEvent, string]> = [
    [{ kind: "started", at: T0 }, "Running"],
    [{ kind: "findings", at: T0, total: 3 }, "Findings gathered"],
    [{ kind: "repair_requested", at: T0 }, "Repair requested"],
    [{ kind: "repair_started", at: T0 }, "Repairing"],
    [
      {
        kind: "pr_opened",
        at: T0,
        number: 1252,
        url: PR_URL,
        title: "fix(DEV-2041): guard empty brand list",
      },
      "Repairing",
    ],
    [{ kind: "tickets_filed", at: T0, tickets: [] }, "Repairing"],
    [{ kind: "ticket_outcomes", at: T0, bucket: "ticket", items: [] }, "Findings gathered"],
    [
      {
        kind: "repair_summary",
        at: T0,
        total: 1,
        fixed: 1,
        falsePositive: 0,
        ticketed: 0,
        pendingRelease: 0,
      },
      "Repairing",
    ],
    [{ kind: "repair_failed", at: T0, reason: "routine API returned 503" }, "Repair failed"],
    [{ kind: "completed", at: T0 }, "Completed"],
    [{ kind: "failed", at: T0, outcome: "crashed" }, "Failed"],
  ];

  it.each(cases)("shows the latest event's status in the header %#", (event, expected) => {
    const started: RunEvent = { kind: "started", at: T0 - 60 };
    const result = renderTimeline(timeline([started, event]));
    expect(headerText(result.blocks)).toContain(expected);
    expect(result.text).toContain(expected);
  });

  it("names the failure outcome in the header", () => {
    const result = renderTimeline(
      timeline([{ kind: "started", at: T0 }, { kind: "failed", at: T0 + 5, outcome: "errored" }]),
    );
    expect(headerText(result.blocks)).toContain("errored");
  });
});

describe("renderTimeline rows", () => {
  it("keeps a Slack local-time token in the compact timeline once findings arrive", () => {
    const result = renderTimeline(
      timeline([
        { kind: "started", at: T0 },
        { kind: "findings", at: T0 + 30, total: 24, autoFix: 9, ticket: 15 },
      ]),
    );
    const lines = sectionLines(result);
    expect(contextText(result)).toContain(`<!date^${T0}^{time}|`);
    expect(lines).toContain("24 findings · all detectors ran");
    expect(lines).toContain("🔧 Auto-fix · 9");
    expect(lines).toContain("🎫 Ticket · 15");
    expect(allText(result)).not.toContain("Acknowledged");
  });

  it("renders a findings event persisted with the legacy repairable/reportOnly fields", () => {
    const lines = sectionLines(
      renderTimeline(
        timeline([{ kind: "findings", at: T0, total: 24, repairable: 9, reportOnly: 15 }]),
      ),
    );
    expect(lines).toContain("🔧 Auto-fix · 9");
    expect(lines).toContain("🎫 Ticket · 15");
  });

  it("shows an Acknowledged bucket only when some findings are acknowledged", () => {
    const lines = (acknowledged: number) =>
      sectionLines(
        renderTimeline(
          timeline([
            { kind: "findings", at: T0, total: 29, autoFix: 9, ticket: 15, acknowledged },
          ]),
        ),
      );
    expect(lines(5)).toContain("💤 Acknowledged · 5");
    expect(lines(0).join("\n")).not.toContain("Acknowledged");
  });

  it("names failed detectors in the summary line, and only when some failed", () => {
    const lines = (failedDetectors: number) =>
      sectionLines(
        renderTimeline(timeline([{ kind: "findings", at: T0, total: 19, failedDetectors }])),
      );
    expect(lines(2)).toContain("19 findings · 2 detectors failed");
    expect(lines(0)).toContain("19 findings · all detectors ran");
  });

  it("shows e2e skipped count and suite duration in the summary line", () => {
    const { text, blocks } = renderTimeline(
      timeline([
        { kind: "started", at: T0 },
        {
          kind: "findings",
          at: T0 + 30,
          passed: 205,
          failed: 0,
          flaky: 0,
          skipped: 1,
          durationSeconds: 471,
        },
      ]),
    );
    expect(text + JSON.stringify(blocks)).toContain(
      "205 passed · 0 failed · 0 flaky · 1 skipped · Duration: 7m 51s",
    );
  });

  it("falls back to UTC HH:mm where Slack cannot localize the time", () => {
    const at = Date.UTC(2026, 8, 25, 7, 5, 0) / 1000;
    const result = renderTimeline(timeline([{ kind: "started", at }]));
    expect(allText(result)).toContain(`<!date^${at}^{time}|07:05>`);
  });

  it("links the opened PR from its row", () => {
    const result = renderTimeline(
      timeline([
        { kind: "started", at: T0 },
        {
          kind: "pr_opened",
          at: T0 + 1,
          number: 1252,
          url: PR_URL,
          title: "fix(DEV-2041): guard empty brand list",
        },
      ]),
    );
    expect(allText(result)).toContain(`PR opened · <${PR_URL}|#1252>`);
  });

  it("shows minutes and seconds since the start on the completed row", () => {
    const result = renderTimeline(
      timeline([
        { kind: "started", at: T0 },
        { kind: "completed", at: T0 + 12 * 60 + 5 },
      ]),
    );
    expect(allText(result)).toContain("Completed · 12m 5s");
  });

  it.each([
    [45, "Completed · 45s"],
    [12 * 60, "Completed · 12m 0s"],
    [2 * 3600 + 5 * 60, "Completed · 2h 5m"],
  ])("formats a %is run duration like the e2e summary", (seconds, expected) => {
    const result = renderTimeline(
      timeline([
        { kind: "started", at: T0 },
        { kind: "completed", at: T0 + seconds },
      ]),
    );
    expect(allText(result)).toContain(expected);
  });

  it("keeps the newest row when long PR URLs overflow the section", () => {
    const longUrl = (n: number) =>
      `https://github.com/ytchou/Formoria/pull/${n}/files?file-filters=${"src/lib/services/run-timeline/".repeat(60)}`;
    const events: RunEvent[] = [{ kind: "started", at: T0 }];
    for (const [i, n] of [1250, 1251, 1252, 1253].entries()) {
      events.push({
        kind: "pr_opened",
        at: T0 + i + 1,
        number: n,
        url: longUrl(n),
        title: `fix(DEV-${2040 + i}): repair health finding`,
      });
    }
    const result = renderTimeline(timeline(events));
    const section = (result.blocks[1] as { text: { text: string } }).text.text;
    const needs = (result.blocks[2] as { text: { text: string } }).text.text;

    expect(section).toContain("|#1253>");
    expect(needs).toContain("|#1253>");
    expect(section).not.toContain("summary truncated");
    expect(needs).not.toContain("summary truncated");
    expect(Array.from(section).length).toBeLessThan(3000);
  });

  it("keeps the first and last rows when there are too many events", () => {
    const events: RunEvent[] = [{ kind: "started", at: T0 }];
    for (let i = 0; i < 80; i += 1) {
      events.push({ kind: "repair_failed", at: T0 + i + 1, reason: `reason-${i}` });
    }
    events.push({ kind: "completed", at: T0 + 500 });
    const result = renderTimeline(timeline(events));
    const text = JSON.stringify(result.blocks);
    expect(text).toContain("Running");
    expect(text).toContain("Completed ·");
    expect(text).not.toContain("reason-40");
    for (const block of result.blocks) {
      const inner = (block as { text?: { text?: string } }).text?.text;
      if (inner) expect(Array.from(inner).length).toBeLessThan(3000);
    }
  });
});

describe("renderTimeline needs-you", () => {
  it("leaves out Needs you when nothing awaits a person", () => {
    const result = renderTimeline(timeline([{ kind: "started", at: T0 }]));
    expect(JSON.stringify(result.blocks)).not.toContain("Needs you");
  });

  it("lists opened PRs and filed tickets under Needs you", () => {
    const result = renderTimeline(
      timeline([
        { kind: "started", at: T0 },
        {
          kind: "pr_opened",
          at: T0 + 1,
          number: 1253,
          url: "https://github.com/ytchou/Formoria/pull/1253",
          title: "Repair slug",
          ticketId: "DEV-2039",
        },
        {
          kind: "tickets_filed",
          at: T0 + 2,
          tickets: [
            {
              id: "DEV-2040",
              url: "https://linear.app/ytchou/issue/DEV-2040",
              title: "Resend domain",
            },
            { id: "DEV-2041", url: TICKET_URL, title: "Stale sitemap" },
          ],
        },
      ]),
    );
    const text = JSON.stringify(result.blocks);
    expect(text).toContain("Needs you");
    expect(text).toContain("DEV-2039");
    expect(text).toContain("Review PR <https://github.com/ytchou/Formoria/pull/1253|#1253>: Repair slug");
    expect(text).toContain("<https://linear.app/ytchou/issue/DEV-2040|DEV-2040> Resend domain");
    expect(text).toContain(`<${TICKET_URL}|DEV-2041> Stale sitemap`);
    expect(text).toContain("2 tickets filed");
  });
});

describe("renderTimeline safety", () => {
  it("never emits a triple-backtick fence", () => {
    const fence = "```json\n{\"repair\":true}\n```";
    const result = renderTimeline(
      timeline(
        [
          { kind: "started", at: T0 },
          { kind: "findings", at: T0 + 1, summary: fence },
          { kind: "repair_failed", at: T0 + 2, reason: fence },
          { kind: "pr_opened", at: T0 + 3, number: 1252, url: PR_URL, title: fence },
          {
            kind: "tickets_filed",
            at: T0 + 4,
            tickets: [{ id: "DEV-2041", url: TICKET_URL, title: fence }],
          },
          { kind: "failed", at: T0 + 5, outcome: fence, reason: fence },
        ],
        fence,
      ),
    );
    expect(result.text).not.toContain("```");
    for (const block of result.blocks) {
      expect(JSON.stringify(block)).not.toContain("```");
    }
  });

  it("names the run ID in the footer", () => {
    const result = renderTimeline(timeline([{ kind: "started", at: T0 }]));
    const last = result.blocks[result.blocks.length - 1] as {
      type: string;
      elements: Array<{ text: string }>;
    };
    expect(last.type).toBe("context");
    expect(last.elements[0]!.text).toContain("Details in thread");
    expect(last.elements[0]!.text).toContain("Run ID: `run-abc`");
  });
});

// 2026-10-01 20:51 UTC, the start of health run b207b9de.
const RUN_START = Date.UTC(2026, 9, 1, 20, 51) / 1000;
const PR_1302 = "https://github.com/ytchou/Formoria/pull/1302";
const linear = (id: string) => `https://linear.app/ytchou/issue/${id}`;

type FindingsEvent = Extract<RunEvent, { kind: "findings" }>;
type TicketOutcomeEvent = Extract<RunEvent, { kind: "ticket_outcomes" }>;
type FindingsCounts = Omit<FindingsEvent, "kind" | "at">;

/** started + findings, then `rest` (each `at` is filled in, in order). */
function run(
  counts: FindingsCounts,
  rest: Array<Record<string, unknown> & { kind: RunEvent["kind"] }> = [],
  start = RUN_START,
): RunTimeline {
  const events = [
    { kind: "started", at: start },
    { kind: "findings", at: start + 360, ...counts },
    ...rest.map((event, i) => ({ at: start + 400 + i * 10, ...event })),
  ] as RunEvent[];
  return timeline(events, "Health Agent — 2026-10-01");
}

const existingClosed: TicketOutcomeEvent["items"][number] = {
  title: "Sentry quota exhausted",
  outcome: "existing",
  ticketId: "DEV-1909",
  url: linear("DEV-1909"),
  ticketedAt: "2026-09-29T20:55:00.000Z",
  state: "Duplicate",
  closed: true,
  followUpOn: "2026-10-13",
};

const CLOSED_FIRING =
  'DEV-1909 is Duplicate but "Sentry quota exhausted" still fires: ' +
  "reopen, acknowledge, or wait for 10/13";

describe("renderTimeline buckets", () => {
  it("renders run b207b9de as three health buckets", () => {
    const events: RunEvent[] = [
      { kind: "started", at: RUN_START },
      {
        kind: "findings",
        at: RUN_START + 360,
        total: 20,
        autoFix: 4,
        ticket: 1,
        acknowledged: 15,
        acknowledgedGroups: [{ ticket: "DEV-1903", until: "2026-12-31", count: 15 }],
      },
      { kind: "repair_requested", at: RUN_START + 420 },
      {
        kind: "repair_started",
        at: RUN_START + 425,
        sessionUrl: "https://claude.ai/code/session_01",
      },
      { kind: "ticket_outcomes", at: RUN_START + 430, bucket: "ticket", items: [existingClosed] },
      {
        kind: "pr_opened",
        at: RUN_START + 600,
        number: 1302,
        url: PR_1302,
        title: "fix(DEV-1912): bump vulnerable dependencies",
        ticketId: "DEV-1912",
      },
      {
        kind: "repair_summary",
        at: RUN_START + 603,
        total: 4,
        fixed: 4,
        falsePositive: 0,
        ticketed: 0,
        pendingRelease: 0,
        notes: ["Next.js advisory GHSA-vcvr-r3jv-pc5j not in batch"],
      },
      { kind: "completed", at: RUN_START + 606 },
    ];
    const result = renderTimeline(timeline(events, "Health Agent — 2026-10-01"));
    const lines = sectionLines(result);

    expect(headerText(result.blocks)).toBe("Health Agent — 2026-10-01 · ✅ Completed · 10m 6s");
    expect(lines).toContain("20 findings · all detectors ran");
    expect(lines).toContain("🔧 Auto-fix · 4 → PR #1302 (DEV-1912)");
    expect(lines).toContain("4 fixed · 0 false positive · 0 pending release");
    expect(lines).toContain("🎫 Ticket · 1 → no new ticket");
    expect(lines).toContain(
      "Sentry quota exhausted: already DEV-1909 (Duplicate, 9/29); follow-up allowed 10/13",
    );
    expect(lines).toContain("💤 Acknowledged · 15 → DEV-1903 (until 2026-12-31)");
    expect(needsYou(result)).toEqual([
      "Review PR #1302 (DEV-1912)",
      CLOSED_FIRING,
      "Repair note: Next.js advisory GHSA-vcvr-r3jv-pc5j not in batch",
    ]);
    expect(visible(contextText(result))).toContain(
      "20:51 start · 20:57 findings · 20:58 repair · 21:01 PR #1302 · 21:01 done",
    );
    expect(contextText(result)).toContain("Run ID: `run-abc`");
    expect(result.text).toBe(
      "Health Agent — 2026-10-01 · ✅ Completed · 10m 6s · 4 auto-fix → PR #1302 (DEV-1912) · " +
        "1 ticket → no new ticket · 15 acknowledged → DEV-1903 (until 2026-12-31)",
    );
    expect(result.blocks.filter((b) => b.type === "header")).toHaveLength(1);
    expect(result.blocks.filter((b) => b.type === "context")).toHaveLength(1);
  });

  it("renders an e2e red run as Failed / Unexpected skips / Flaky buckets", () => {
    const result = renderTimeline(
      timeline([
        { kind: "started", at: RUN_START },
        {
          kind: "findings",
          at: RUN_START + 480,
          passed: 200,
          failed: 3,
          flaky: 1,
          skipped: 2,
          unexpectedSkips: 1,
          durationSeconds: 471,
          summary: "1 unexpected skips",
        },
        { kind: "repair_requested", at: RUN_START + 490 },
        { kind: "repair_started", at: RUN_START + 495 },
        {
          kind: "pr_opened",
          at: RUN_START + 900,
          number: 1310,
          url: "https://github.com/ytchou/Formoria/pull/1310",
          title: "fix(e2e): update brand card selector",
        },
        {
          kind: "repair_summary",
          at: RUN_START + 905,
          total: 4,
          fixed: 3,
          falsePositive: 1,
          ticketed: 0,
          pendingRelease: 0,
        },
        { kind: "completed", at: RUN_START + 910 },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("200 passed · 3 failed · 1 flaky · 2 skipped · Duration: 7m 51s");
    expect(lines).toContain("❌ Failed · 3 → PR #1310");
    expect(lines).toContain("3 fixed · 1 false positive · 0 pending release");
    expect(lines).toContain("⏭️ Unexpected skips · 1 → in the same repair");
    expect(lines).toContain("🔁 Flaky · 1 → passed on retry · no action");
    expect(lines.some((l) => /Passed ·|Skipped ·/.test(l))).toBe(false);
    expect(needsYou(result)).toEqual(["Review PR #1310"]);
  });

  it("keeps today's row view before findings arrives", () => {
    const result = renderTimeline(timeline([{ kind: "started", at: RUN_START }]));
    expect(sectionLines(result)).toEqual(["20:51  🔄  Running"]);
    expect(allText(result)).not.toContain("Auto-fix");
  });

  it("renders a legacy timeline", () => {
    const events = [
      { kind: "started", at: RUN_START },
      { kind: "findings", at: RUN_START + 60, total: 24, repairable: 9, reportOnly: 15 },
      {
        kind: "tickets_filed",
        at: RUN_START + 70,
        tickets: [{ id: "DEV-2040", url: linear("DEV-2040"), title: "Resend domain" }],
      },
      { kind: "repair_requested", at: RUN_START + 80 },
    ] as RunEvent[];
    let result: Rendered | undefined;
    expect(() => {
      result = renderTimeline(timeline(events));
    }).not.toThrow();
    const lines = sectionLines(result!);
    expect(lines).toContain("24 findings · all detectors ran");
    expect(lines).toContain("🔧 Auto-fix · 9 → repair requested");
    expect(lines).toContain("🎫 Ticket · 15 → 1 ticket filed");
    expect(lines).toContain("DEV-2040 Resend domain");
    expect(needsYou(result!)).toEqual(["Triage DEV-2040 Resend domain"]);
  });

  it("attaches routine-filed tickets in a health run to the auto-fix bucket", () => {
    const result = renderTimeline(
      run({ total: 2, autoFix: 2, ticket: 0 }, [
        { kind: "ticket_outcomes", bucket: "ticket", items: [] },
        { kind: "repair_requested" },
        { kind: "repair_started" },
        {
          kind: "tickets_filed",
          tickets: [{ id: "DEV-2070", url: linear("DEV-2070"), title: "Env var missing" }],
        },
        { kind: "completed" },
      ]),
    );
    expect(sectionLines(result)).toContain("🔧 Auto-fix · 2 → no PR · 1 ticket filed");
    expect(needsYou(result)).toEqual(["Triage DEV-2070 Env var missing"]);
  });

  it("strips fences and escapes routine notes", () => {
    const result = renderTimeline(
      run({ total: 1, autoFix: 1, ticket: 0 }, [
        { kind: "repair_requested" },
        {
          kind: "repair_summary",
          total: 1,
          fixed: 1,
          falsePositive: 0,
          ticketed: 0,
          pendingRelease: 0,
          notes: ['```json {"repair":true}``` <!channel> see https://example.com'],
        },
      ]),
    );
    const text = allText(result);
    expect(text).not.toContain("```");
    expect(text).not.toContain("<!channel>");
    expect(text).toContain("&lt;!channel&gt;");
  });

  it("keeps every section under 3000 chars with 50 outcome items", () => {
    const longTitle = (i: number) => `Finding ${i} ${"x".repeat(200)}`;
    const ticketItems = Array.from({ length: 50 }, (_, i) => ({
      ...existingClosed,
      title: longTitle(i),
      ticketId: `DEV-${3000 + i}`,
      url: linear(`DEV-${3000 + i}`),
    }));
    const autoFixItems = Array.from({ length: 50 }, (_, i) => ({
      title: longTitle(i),
      outcome: "filed" as const,
      ticketId: `DEV-${4000 + i}`,
      url: linear(`DEV-${4000 + i}`),
    }));
    const result = renderTimeline(
      run({ total: 100, autoFix: 50, ticket: 50 }, [
        { kind: "ticket_outcomes", bucket: "ticket", items: ticketItems },
        { kind: "ticket_outcomes", bucket: "auto_fix", items: autoFixItems },
        { kind: "repair_failed", reason: "trigger rejected" },
      ]),
    );
    for (const block of result.blocks) {
      const texts = [
        (block as { text?: { text?: string } }).text?.text,
        ...((block as { elements?: Array<{ text: string }> }).elements ?? []).map((e) => e.text),
      ];
      for (const text of texts) {
        if (text) expect(Array.from(text).length).toBeLessThan(3000);
      }
    }
    const needs = sectionTexts(result).find((t) => t.startsWith("*Needs you*"))!;
    expect(needs).toContain("rows omitted");
    expect(needs).not.toContain("summary truncated");
  });
});

// One test per row of the design's Edge cases table, named after the row.
describe("renderTimeline edge cases", () => {
  it("pending release", () => {
    const result = renderTimeline(
      run({ total: 3, autoFix: 3, ticket: 0 }, [
        { kind: "repair_requested" },
        { kind: "repair_started" },
        {
          kind: "repair_summary",
          total: 3,
          fixed: 0,
          falsePositive: 0,
          ticketed: 0,
          pendingRelease: 3,
          pendingReleaseTickets: ["DEV-1912"],
        },
        { kind: "completed" },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("🔧 Auto-fix · 3 → no PR");
    expect(lines).toContain("0 fixed · 0 false positive · 3 fix pending release (DEV-1912)");
    expect(needsYou(result)).toEqual(["Promote staging to clear 3 findings (DEV-1912)"]);
  });

  it("no PR", () => {
    const note =
      "gh pr create failed; compare " +
      "https://github.com/ytchou/Formoria/compare/staging...ops/fix-deps";
    const result = renderTimeline(
      run({ total: 4, autoFix: 4, ticket: 0 }, [
        { kind: "repair_requested" },
        { kind: "repair_started" },
        {
          kind: "repair_summary",
          total: 4,
          fixed: 4,
          falsePositive: 0,
          ticketed: 0,
          pendingRelease: 0,
          notes: [note],
        },
        { kind: "completed" },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("🔧 Auto-fix · 4 → no PR");
    expect(lines).toContain(note);
    expect(needsYou(result)).toEqual([`Repair note: ${note}`]);
  });

  it("repair failed", () => {
    const result = renderTimeline(
      run({ total: 4, autoFix: 4, ticket: 0 }, [
        { kind: "repair_requested" },
        { kind: "repair_failed", reason: "routine API returned 503" },
      ]),
    );
    expect(sectionLines(result)).toContain(
      "🔧 Auto-fix · 4 → repair failed: routine API returned 503",
    );
    expect(needsYou(result)).toEqual(["Repair failed: findings re-send tomorrow"]);
  });

  it("health-filed auto_fix tickets", () => {
    const result = renderTimeline(
      run({ total: 2, autoFix: 2, ticket: 0 }, [
        {
          kind: "ticket_outcomes",
          bucket: "auto_fix",
          items: [
            {
              title: "Resend domain unverified",
              outcome: "filed",
              ticketId: "DEV-2050",
              url: linear("DEV-2050"),
            },
            {
              title: "Stale sitemap",
              outcome: "filed",
              ticketId: "DEV-2051",
              url: linear("DEV-2051"),
            },
          ],
        },
        { kind: "repair_failed", reason: "trigger rejected: 401" },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("🔧 Auto-fix · 2 → repair not run · 2 tickets filed");
    expect(lines).toContain("Resend domain unverified: filed DEV-2050");
    expect(lines).toContain("repair failed: trigger rejected: 401");
    expect(needsYou(result)).toEqual([
      "Triage DEV-2050 Resend domain unverified",
      "Triage DEV-2051 Stale sitemap",
    ]);
  });

  it("completed without repair_summary", () => {
    const result = renderTimeline(
      run({ total: 4, autoFix: 4, ticket: 0 }, [
        { kind: "repair_requested" },
        { kind: "repair_started" },
        { kind: "pr_opened", number: 1302, url: PR_1302, title: "fix deps", ticketId: "DEV-1912" },
        { kind: "completed" },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("🔧 Auto-fix · 4 → PR #1302 (DEV-1912)");
    expect(lines).toContain("outcome counts not reported");
    expect(needsYou(result)).toEqual(["Review PR #1302 (DEV-1912)"]);
  });

  it("run failed", () => {
    const result = renderTimeline(
      run({ total: 5, autoFix: 2, ticket: 3 }, [
        { kind: "failed", outcome: "crashed", reason: "detector timeout" },
      ]),
    );
    expect(headerText(result.blocks)).toContain("❌ Failed");
    const lines = sectionLines(result);
    expect(lines).toContain("🔧 Auto-fix · 2 → repair not run");
    expect(lines).toContain("🎫 Ticket · 3");
    expect(needsYou(result)).toEqual(["Run failed: crashed · detector timeout"]);
  });

  it("ledger not processed", () => {
    const result = renderTimeline(
      run({ total: 2, autoFix: 0, ticket: 2 }, [
        {
          kind: "ticket_outcomes",
          bucket: "ticket",
          items: [
            {
              title: "Sentry quota exhausted",
              outcome: "not_processed",
              reason: "ticket ledger read failed",
            },
            { title: "Stale sitemap", outcome: "not_processed", reason: "ticket ledger read failed" },
          ],
        },
      ]),
    );
    expect(sectionLines(result)).toContain("🎫 Ticket · 2 → not processed (ledger read failed)");
    expect(needsYou(result)).toEqual(["Ticket step skipped: 2 findings unticketed"]);
  });

  it("filing failed", () => {
    const result = renderTimeline(
      run({ total: 2, autoFix: 0, ticket: 2 }, [
        {
          kind: "ticket_outcomes",
          bucket: "ticket",
          items: [
            {
              title: "Resend domain unverified",
              outcome: "filed",
              ticketId: "DEV-2060",
              url: linear("DEV-2060"),
            },
            { title: "Stale sitemap", outcome: "failed", reason: "Linear returned 500" },
          ],
        },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("🎫 Ticket · 2 → 1 new ticket");
    expect(lines).toContain("Stale sitemap: filing failed: Linear returned 500");
    expect(needsYou(result)).toEqual([
      "Triage DEV-2060 Resend domain unverified",
      'Ticket filing failed for "Stale sitemap"',
    ]);
  });

  it("existing open", () => {
    const open = {
      ...existingClosed,
      ticketId: "DEV-1950",
      url: linear("DEV-1950"),
      state: "In Progress",
      closed: false,
    };
    const result = renderTimeline(
      run({ total: 1, autoFix: 0, ticket: 1 }, [
        { kind: "ticket_outcomes", bucket: "ticket", items: [open] },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("🎫 Ticket · 1 → no new ticket");
    expect(lines).toContain("Sentry quota exhausted: already DEV-1950 (In Progress, 9/29)");
    expect(needsYou(result)).toEqual([]);
  });

  it("existing closed", () => {
    const result = renderTimeline(
      run({ total: 1, autoFix: 0, ticket: 1 }, [
        { kind: "ticket_outcomes", bucket: "ticket", items: [existingClosed] },
      ]),
    );
    expect(sectionLines(result)).toContain(
      "Sentry quota exhausted: already DEV-1909 (Duplicate, 9/29); follow-up allowed 10/13",
    );
    expect(needsYou(result)).toEqual([CLOSED_FIRING]);
  });

  it("state unknown", () => {
    const { state: _state, closed: _closed, ...unknown } = existingClosed;
    const result = renderTimeline(
      run({ total: 1, autoFix: 0, ticket: 1 }, [
        { kind: "ticket_outcomes", bucket: "ticket", items: [unknown] },
      ]),
    );
    expect(sectionLines(result)).toContain(
      "Sentry quota exhausted: already DEV-1909 (state unknown, 9/29)",
    );
    expect(needsYou(result)).toEqual([]);
  });

  it("not eligible", () => {
    const result = renderTimeline(
      run({ total: 1, autoFix: 0, ticket: 1 }, [
        {
          kind: "ticket_outcomes",
          bucket: "ticket",
          items: [{ title: "Sentry spike", outcome: "not_eligible", reason: "sentry source" }],
        },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("🎫 Ticket · 1 → no new ticket");
    expect(lines).toContain("Sentry spike: not eligible: sentry source");
    expect(needsYou(result)).toEqual([]);
  });

  it("many items", () => {
    const items: TicketOutcomeEvent["items"] = [
      ...Array.from({ length: 3 }, (_, i) => ({
        title: `Finding ${i}`,
        outcome: "filed" as const,
        ticketId: `DEV-${2100 + i}`,
        url: linear(`DEV-${2100 + i}`),
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        ...existingClosed,
        title: `Finding ${3 + i}`,
        state: "Todo",
        closed: false,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        title: `Finding ${7 + i}`,
        outcome: "not_eligible" as const,
        reason: "sentry source",
      })),
    ];
    const result = renderTimeline(
      run({ total: 12, autoFix: 0, ticket: 12 }, [
        { kind: "ticket_outcomes", bucket: "ticket", items },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("🎫 Ticket · 12 → 3 new tickets");
    expect(lines).toContain("3 filed · 4 existing · 5 not eligible");
    expect(lines.filter((l) => /^Finding \d+:/.test(l))).toHaveLength(5);
    expect(lines).toContain("… 7 more");
    expect(needsYou(result)).toHaveLength(3);
  });

  it("ack expiring ≤7 days", () => {
    const ack = (start: number) =>
      renderTimeline(
        run(
          {
            total: 15,
            autoFix: 0,
            ticket: 0,
            acknowledged: 15,
            acknowledgedGroups: [{ ticket: "DEV-1903", until: "2026-12-31", count: 15 }],
          },
          [],
          start,
        ),
      );
    // 12-28 20:51 UTC is 12-29 in Asia/Taipei, the health agent's logical date.
    const expiring = ack(Date.UTC(2026, 11, 28, 20, 51) / 1000);
    expect(sectionLines(expiring)).toContain(
      "💤 Acknowledged · 15 → DEV-1903 (until 2026-12-31, expires in 2d)",
    );
    expect(needsYou(expiring)).toEqual([
      "Acknowledgement DEV-1903 expires 2026-12-31: 15 findings will route again",
    ]);

    // 7 Taipei days out (12-23 20:51 UTC = 12-24 Taipei): still flagged.
    const sevenDays = ack(Date.UTC(2026, 11, 23, 20, 51) / 1000);
    expect(sectionLines(sevenDays)).toContain(
      "💤 Acknowledged · 15 → DEV-1903 (until 2026-12-31, expires in 7d)",
    );

    // 8 Taipei days out (12-22 20:51 UTC = 12-23 Taipei): not flagged yet.
    const notYet = ack(Date.UTC(2026, 11, 22, 20, 51) / 1000);
    expect(sectionLines(notYet)).toContain("💤 Acknowledged · 15 → DEV-1903 (until 2026-12-31)");
    expect(needsYou(notYet)).toEqual([]);
  });

  it("failed detectors by name", () => {
    const result = renderTimeline(
      run({
        total: 19,
        autoFix: 0,
        ticket: 0,
        failedDetectors: 2,
        failedDetectorNames: ["sentry", "knip"],
      }),
    );
    expect(sectionLines(result)).toContain("19 findings · 2 detectors failed");
    expect(needsYou(result)).toEqual([
      "Detectors failed: sentry, knip; their findings are missing",
    ]);
  });

  it("zero findings", () => {
    const result = renderTimeline(
      run({ total: 0, autoFix: 0, ticket: 0 }, [{ kind: "completed" }]),
    );
    expect(sectionLines(result)).toEqual(["0 findings · all detectors ran"]);
    expect(result.blocks.map((b) => b.type)).toEqual(["header", "section", "context"]);
    expect(needsYou(result)).toEqual([]);
  });

  it("e2e green", () => {
    const result = renderTimeline(
      run(
        { passed: 205, failed: 0, flaky: 0, skipped: 1, unexpectedSkips: 0, durationSeconds: 471 },
        [{ kind: "completed" }],
      ),
    );
    expect(sectionLines(result)).toEqual([
      "205 passed · 0 failed · 0 flaky · 1 skipped · Duration: 7m 51s",
    ]);
    expect(result.blocks.map((b) => b.type)).toEqual(["header", "section", "context"]);
    expect(needsYou(result)).toEqual([]);
  });
});

describe("renderTimeline review fixes", () => {
  it("counts acknowledgement expiry in Asia/Taipei days (expires today on the logical date)", () => {
    const result = renderTimeline(
      run(
        {
          total: 1,
          autoFix: 0,
          ticket: 0,
          acknowledged: 1,
          acknowledgedGroups: [{ ticket: "DEV-1903", until: "2026-12-31", count: 1 }],
        },
        [],
        // 12-30 20:51 UTC is 12-31 in Asia/Taipei.
        Date.UTC(2026, 11, 30, 20, 51) / 1000,
      ),
    );
    expect(sectionLines(result)).toContain(
      "💤 Acknowledged · 1 → DEV-1903 (until 2026-12-31, expires today)",
    );
  });

  it("surfaces unprocessed auto-fix fallback items when the ledger and the trigger both fail", () => {
    const result = renderTimeline(
      run({ total: 2, autoFix: 2, ticket: 0 }, [
        {
          kind: "ticket_outcomes",
          bucket: "auto_fix",
          items: [
            { title: "Resend domain", outcome: "not_processed", reason: "ticket ledger read failed" },
            { title: "Stale sitemap", outcome: "not_processed", reason: "ticket ledger read failed" },
          ],
        },
        { kind: "repair_failed", reason: "trigger rejected: 401" },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("🔧 Auto-fix · 2 → repair not run · not processed (ledger read failed)");
    expect(lines.join("\n")).not.toContain("0 tickets filed");
    expect(lines).toContain("repair failed: trigger rejected: 401");
    expect(needsYou(result)).toEqual([
      "Repair failed: findings re-send tomorrow",
      "Ticket step skipped: 2 findings unticketed",
    ]);
  });

  it("names the enqueue, not the ledger, when findings were not enqueued", () => {
    const result = renderTimeline(
      run({ total: 2, autoFix: 0, ticket: 2 }, [
        {
          kind: "ticket_outcomes",
          bucket: "ticket",
          items: [
            { title: "Sentry quota", outcome: "not_processed", reason: "finding was not enqueued" },
            { title: "Stale sitemap", outcome: "not_processed", reason: "finding was not enqueued" },
          ],
        },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("🎫 Ticket · 2 → not processed (finding was not enqueued)");
    expect(allText(result)).not.toContain("ledger");
    expect(needsYou(result)).toEqual(["Ticket step skipped: 2 findings unticketed"]);
  });

  it("keeps routine tickets in the auto-fix bucket when repair_started was lost", () => {
    const result = renderTimeline(
      run({ total: 2, autoFix: 2, ticket: 0 }, [
        { kind: "repair_requested" },
        {
          kind: "tickets_filed",
          tickets: [{ id: "DEV-2070", url: linear("DEV-2070"), title: "Env var missing" }],
        },
        { kind: "completed" },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("🔧 Auto-fix · 2 → no PR · 1 ticket filed");
    expect(lines.some((l) => l.startsWith("🎫 Ticket"))).toBe(false);
    expect(needsYou(result)).toEqual(["Triage DEV-2070 Env var missing"]);
  });

  it("prefers a PR opened after an ambiguous repair_failed", () => {
    const result = renderTimeline(
      run({ total: 4, autoFix: 4, ticket: 0 }, [
        { kind: "repair_requested" },
        { kind: "repair_failed", reason: "trigger post timed out" },
        { kind: "repair_started" },
        { kind: "pr_opened", number: 1302, url: PR_1302, title: "fix deps", ticketId: "DEV-1912" },
        { kind: "completed" },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("🔧 Auto-fix · 4 → PR #1302 (DEV-1912)");
    expect(lines.join("\n")).not.toContain("repair failed");
    expect(needsYou(result)).toEqual(["Review PR #1302 (DEV-1912)"]);
  });

  it("prefers a repair_summary after repair_failed even without repair_started", () => {
    const result = renderTimeline(
      run({ total: 1, autoFix: 1, ticket: 0 }, [
        { kind: "repair_requested" },
        { kind: "repair_failed", reason: "trigger post timed out" },
        {
          kind: "repair_summary",
          total: 1,
          fixed: 1,
          falsePositive: 0,
          ticketed: 0,
          pendingRelease: 0,
        },
        { kind: "completed" },
      ]),
    );
    const lines = sectionLines(result);
    expect(lines).toContain("🔧 Auto-fix · 1 → no PR");
    expect(needsYou(result)).toEqual([]);
  });
});
