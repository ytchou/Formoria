import { describe, expect, it } from "vitest";
import { renderTimeline } from "../render";
import type { RunEvent, RunTimeline } from "../types";

const T0 = 1_758_700_000; // epoch seconds

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
    [{ kind: "pr_opened", at: T0, number: 1, url: "https://x/1", title: "t" }, "Repairing"],
    [{ kind: "tickets_filed", at: T0, tickets: [] }, "Repairing"],
    [{ kind: "repair_failed", at: T0, reason: "boom" }, "Repair failed"],
    [{ kind: "completed", at: T0 }, "Completed"],
    [{ kind: "failed", at: T0, outcome: "crashed" }, "Failed"],
  ];

  it.each(cases)("status_derives_from_latest_event %#", (event, expected) => {
    const started: RunEvent = { kind: "started", at: T0 - 60 };
    const result = renderTimeline(timeline([started, event]));
    expect(headerText(result.blocks)).toContain(expected);
    expect(result.text).toContain(expected);
  });

  it("failed_status_includes_outcome", () => {
    const result = renderTimeline(
      timeline([{ kind: "started", at: T0 }, { kind: "failed", at: T0 + 5, outcome: "errored" }]),
    );
    expect(headerText(result.blocks)).toContain("errored");
  });
});

describe("renderTimeline rows", () => {
  it("renders_one_row_per_event_with_slack_date_token", () => {
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

  it("date_fallback_is_utc_hh_mm", () => {
    const at = Date.UTC(2026, 8, 25, 7, 5, 0) / 1000;
    const result = renderTimeline(timeline([{ kind: "started", at }]));
    expect(allText(result)).toContain(`<!date^${at}^{time}|07:05>`);
  });

  it("pr_opened_row_links_the_pr", () => {
    const result = renderTimeline(
      timeline([
        { kind: "started", at: T0 },
        { kind: "pr_opened", at: T0 + 1, number: 1252, url: "https://gh/pr/1252", title: "Fix" },
      ]),
    );
    expect(allText(result)).toContain("PR opened · <https://gh/pr/1252|#1252>");
  });

  it("completed_row_shows_duration_since_started", () => {
    const result = renderTimeline(
      timeline([
        { kind: "started", at: T0 },
        { kind: "completed", at: T0 + 12 * 60 },
      ]),
    );
    expect(allText(result)).toContain("Completed · 12m");
  });

  it("keeps_first_and_last_rows_when_too_many", () => {
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
  it("needs_you_absent_when_no_pr_or_tickets", () => {
    const result = renderTimeline(timeline([{ kind: "started", at: T0 }]));
    expect(JSON.stringify(result.blocks)).not.toContain("Needs you");
  });

  it("needs_you_lists_prs_and_tickets", () => {
    const result = renderTimeline(
      timeline([
        { kind: "started", at: T0 },
        {
          kind: "pr_opened",
          at: T0 + 1,
          number: 7,
          url: "https://gh/pr/7",
          title: "Repair slug",
          ticketId: "DEV-9",
        },
        {
          kind: "tickets_filed",
          at: T0 + 2,
          tickets: [
            { id: "DEV-10", url: "https://linear/DEV-10", title: "Resend domain" },
            { id: "DEV-11", url: "https://linear/DEV-11", title: "Stale sitemap" },
          ],
        },
      ]),
    );
    const text = JSON.stringify(result.blocks);
    expect(text).toContain("Needs you");
    expect(text).toContain("DEV-9");
    expect(text).toContain("Review PR <https://gh/pr/7|#7>: Repair slug");
    expect(text).toContain("<https://linear/DEV-10|DEV-10> Resend domain");
    expect(text).toContain("<https://linear/DEV-11|DEV-11> Stale sitemap");
    expect(text).toContain("2 tickets filed");
  });
});

describe("renderTimeline safety", () => {
  it("never_emits_a_triple_backtick_fence", () => {
    const fence = "```json\n{\"repair\":true}\n```";
    const result = renderTimeline(
      timeline(
        [
          { kind: "started", at: T0 },
          { kind: "findings", at: T0 + 1, summary: fence },
          { kind: "repair_failed", at: T0 + 2, reason: fence },
          { kind: "pr_opened", at: T0 + 3, number: 1, url: "https://x", title: fence },
          {
            kind: "tickets_filed",
            at: T0 + 4,
            tickets: [{ id: "DEV-1", url: "https://y", title: fence }],
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

  it("footer_names_run_id", () => {
    const result = renderTimeline(timeline([{ kind: "started", at: T0 }]));
    const last = result.blocks[result.blocks.length - 1] as {
      type: string;
      elements: Array<{ text: string }>;
    };
    expect(last.type).toBe("context");
    expect(last.elements[0]!.text).toContain("Details in thread");
    expect(last.elements[0]!.text).toContain("run-abc");
  });
});
