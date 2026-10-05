import { describe, expect, it } from "vitest";
import {
  pendingExemptSubmissionIds,
  unappliedSubmissions,
  rejectionNote,
  type AppliedEntry,
} from "../refresh-unapplied";

describe("unappliedSubmissions", () => {
  it("picks failed and missing applies", () => {
    const requested = new Map([
      ["brand-a", "sub-1"],
      ["brand-b", "sub-2"],
      ["brand-c", "sub-3"],
    ]);
    const applied: AppliedEntry[] = [
      { slug: "brand-a", submissionId: "sub-1", ok: true, detail: "applied" },
      {
        slug: "brand-b",
        submissionId: "sub-2",
        ok: false,
        detail: "Refresh is stale",
      },
      // brand-c has no apply entry at all
    ];

    const result = unappliedSubmissions(requested, applied);

    expect(result).toEqual([
      {
        slug: "brand-b",
        submissionId: "sub-2",
        detail: "Refresh is stale",
      },
      {
        slug: "brand-c",
        submissionId: "sub-3",
        detail: "not applied",
      },
    ]);
  });

  it("is empty when all applied successfully", () => {
    const requested = new Map([
      ["brand-a", "sub-1"],
      ["brand-b", "sub-2"],
    ]);
    const applied: AppliedEntry[] = [
      { slug: "brand-a", submissionId: "sub-1", ok: true, detail: "applied" },
      { slug: "brand-b", submissionId: "sub-2", ok: true, detail: "applied" },
    ];

    const result = unappliedSubmissions(requested, applied);

    expect(result).toEqual([]);
  });
});

describe("a skipped target stays pending only when its apply failed at the enrichment-run gate", () => {
  const GATE_FAILURE =
    "Refresh must have a successful enrichment run before apply";
  const requested = new Map([
    ["bobo-and-puff", "sub-bobo"],
    ["ink-and-oak", "sub-ink"],
    ["paper-mill", "sub-paper"],
    ["tea-house", "sub-tea"],
  ]);

  /** Runs the same two steps refresh.ts runs: the exempt set, then the reject list. */
  function rejectList(applied: AppliedEntry[], skipped: string[]) {
    const exempt = pendingExemptSubmissionIds(applied, new Set(skipped));
    return { exempt, rejected: unappliedSubmissions(requested, applied, exempt) };
  }

  it("leaves a skipped target that failed at the gate out of the reject list", () => {
    const applied: AppliedEntry[] = [
      { slug: "bobo-and-puff", submissionId: "sub-bobo", ok: false, detail: GATE_FAILURE },
      { slug: "ink-and-oak", submissionId: "sub-ink", ok: true, detail: "applied" },
      { slug: "paper-mill", submissionId: "sub-paper", ok: true, detail: "applied" },
      { slug: "tea-house", submissionId: "sub-tea", ok: true, detail: "applied" },
    ];

    const { exempt, rejected } = rejectList(applied, ["sub-bobo"]);

    expect([...exempt]).toEqual(["sub-bobo"]);
    expect(rejected).toEqual([]);
  });

  it("rejects a skipped target whose apply failed on a stale snapshot", () => {
    const stale = "Refresh is stale: brand changed after request";
    const applied: AppliedEntry[] = [
      { slug: "bobo-and-puff", submissionId: "sub-bobo", ok: true, detail: "applied" },
      { slug: "ink-and-oak", submissionId: "sub-ink", ok: false, detail: stale },
      { slug: "paper-mill", submissionId: "sub-paper", ok: true, detail: "applied" },
      { slug: "tea-house", submissionId: "sub-tea", ok: true, detail: "applied" },
    ];

    const { exempt, rejected } = rejectList(applied, ["sub-ink"]);

    expect(exempt.size).toBe(0);
    expect(rejected).toEqual([
      { slug: "ink-and-oak", submissionId: "sub-ink", detail: stale },
    ]);
  });

  it("rejects a gate failure whose target did not end skipped", () => {
    const applied: AppliedEntry[] = [
      { slug: "bobo-and-puff", submissionId: "sub-bobo", ok: true, detail: "applied" },
      { slug: "ink-and-oak", submissionId: "sub-ink", ok: true, detail: "applied" },
      { slug: "paper-mill", submissionId: "sub-paper", ok: false, detail: GATE_FAILURE },
      { slug: "tea-house", submissionId: "sub-tea", ok: true, detail: "applied" },
    ];

    const { exempt, rejected } = rejectList(applied, []);

    expect(exempt.size).toBe(0);
    expect(rejected).toEqual([
      { slug: "paper-mill", submissionId: "sub-paper", detail: GATE_FAILURE },
    ]);
  });

  it("rejects a skipped target that was never attempted as not applied", () => {
    const applied: AppliedEntry[] = [
      { slug: "bobo-and-puff", submissionId: "sub-bobo", ok: true, detail: "applied" },
      { slug: "ink-and-oak", submissionId: "sub-ink", ok: true, detail: "applied" },
      { slug: "paper-mill", submissionId: "sub-paper", ok: true, detail: "applied" },
    ];

    const { exempt, rejected } = rejectList(applied, ["sub-tea"]);

    expect(exempt.size).toBe(0);
    expect(rejected).toEqual([
      { slug: "tea-house", submissionId: "sub-tea", detail: "not applied" },
    ]);
  });
});

describe("rejectionNote", () => {
  it("names job and reason", () => {
    const note = rejectionNote("job-abc-123", "Refresh is stale");
    expect(note).toBe("DEV-1689 job-abc-123: Refresh is stale");
  });

  it("truncates to 500 chars", () => {
    const longDetail = "x".repeat(600);
    const note = rejectionNote("job-1", longDetail);
    expect(note.length).toBe(500);
    expect(note.startsWith("DEV-1689 job-1: ")).toBe(true);
  });
});
