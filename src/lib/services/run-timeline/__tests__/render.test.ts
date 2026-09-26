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

function allText(result: { text: string; blocks: Array<Record<string, unknown>> }): string {
  return result.text + JSON.stringify(result.blocks);
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
  it("renders one row per event with a Slack local-time token", () => {
    const result = renderTimeline(
      timeline([
        { kind: "started", at: T0 },
        { kind: "findings", at: T0 + 30, total: 24, repairable: 9, reportOnly: 15 },
      ]),
    );
    const text = allText(result);
    expect(text).toContain(`<!date^${T0}^{time}|`);
    expect(text).toContain("24 findings · 9 repairable · 15 report-only");
  });

  it("names failed detectors in the findings row, and only when some failed", () => {
    const row = (failedDetectors: number) =>
      allText(
        renderTimeline(
          timeline([{ kind: "findings", at: T0, total: 19, failedDetectors }]),
        ),
      );
    expect(row(2)).toContain("19 findings · 2 detectors failed");
    expect(row(0)).not.toContain("failed");
  });

  it("shows e2e skipped count and suite duration in the findings row", () => {
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
