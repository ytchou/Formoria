import { describe, expect, it } from "vitest";
import {
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
