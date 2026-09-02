/**
 * Pure formatting logic for the acquisition-agent trace exporter.
 * No Supabase client — only the exported functions that render decision
 * timelines and tool spans into markdown.
 */
import { describe, expect, it } from "vitest";

import {
  type DecisionStep,
  type ToolSpan,
  renderDecisionTimeline,
} from "../export-traces";

// ---------------------------------------------------------------------------
// renderDecisionTimeline
// ---------------------------------------------------------------------------

describe("renderDecisionTimeline", () => {
  it("export_renders_decision_timeline_in_order — decisions sorted by ms", () => {
    const decisions: DecisionStep[] = [
      { ms: 200, phase: "plan", action: "selected search strategy", detail: "google" },
      { ms: 100, phase: "plan", action: "parsed brand row", detail: "slug=alpha" },
      { ms: 500, phase: "execute", action: "scraped website", detail: "https://alpha.com" },
    ];
    const spans: ToolSpan[] = [];

    const md = renderDecisionTimeline("alpha", decisions, spans);

    const lines = md.split("\n").filter((l) => l.startsWith("|"));
    // Header + separator + 3 data rows
    expect(lines).toHaveLength(5);

    // Verify order: 100ms, 200ms, 500ms
    const msValues = lines
      .slice(2) // skip header + separator
      .map((line) => {
        const cells = line.split("|").map((c) => c.trim());
        return parseInt(cells[1], 10);
      });
    expect(msValues).toEqual([100, 200, 500]);
  });

  it("tool spans are joined by spanId into the timeline", () => {
    const decisions: DecisionStep[] = [
      { ms: 100, phase: "plan", action: "start", detail: "" },
    ];
    const spans: ToolSpan[] = [
      {
        spanId: "sp-1",
        provider: "openai",
        ms: 150,
        durationMs: 320,
        status: 200,
        detail: "gpt-4o completion",
      },
      {
        spanId: "sp-2",
        provider: "browserless",
        ms: 400,
        durationMs: 1200,
        status: 200,
        detail: "scrape https://alpha.com",
      },
    ];

    const md = renderDecisionTimeline("alpha", decisions, spans);

    // All entries present (1 decision + 2 spans = 3 data rows)
    const dataRows = md.split("\n").filter((l) => l.startsWith("|")).slice(2);
    expect(dataRows).toHaveLength(3);

    // Sorted by ms: 100, 150, 400
    const msValues = dataRows.map((line) => {
      const cells = line.split("|").map((c) => c.trim());
      return parseInt(cells[1], 10);
    });
    expect(msValues).toEqual([100, 150, 400]);

    // Span rows include provider and duration
    expect(md).toContain("openai");
    expect(md).toContain("320ms");
    expect(md).toContain("browserless");
    expect(md).toContain("1200ms");
  });

  it("empty decisions and spans produce a header-only table", () => {
    const md = renderDecisionTimeline("empty-brand", [], []);
    const lines = md.split("\n").filter((l) => l.startsWith("|"));
    // Header + separator only
    expect(lines).toHaveLength(2);
  });
});
