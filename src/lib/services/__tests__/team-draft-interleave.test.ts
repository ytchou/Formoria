import { describe, expect, it } from "vitest";
import { teamDraftInterleave } from "../team-draft-interleave";

describe("teamDraftInterleave", () => {
  it("produces deterministic output for a given seed", () => {
    const rrf = ["a", "b", "c"];
    const ltr = ["b", "c", "d"];

    const r1 = teamDraftInterleave(rrf, ltr, "test-seed");
    const r2 = teamDraftInterleave(rrf, ltr, "test-seed");

    expect(r1.merged).toEqual(r2.merged);
    expect(r1.armBySlot).toEqual(r2.armBySlot);
  });

  it("alternates picks when lists share items", () => {
    const rrf = ["a", "b", "c"];
    const ltr = ["b", "a", "d"];

    const { merged, armBySlot } = teamDraftInterleave(rrf, ltr, "overlap");

    // Every item from both lists appears exactly once
    const union = new Set([...rrf, ...ltr]);
    expect(new Set(merged)).toEqual(union);
    expect(merged.length).toBe(union.size);

    // Each slot attributed to exactly one arm
    expect(armBySlot.length).toBe(merged.length);
    for (const arm of armBySlot) {
      expect(["rrf", "ltr"]).toContain(arm);
    }
  });

  it("handles disjoint lists", () => {
    const rrf = ["a", "b"];
    const ltr = ["c", "d"];

    const { merged, armBySlot } = teamDraftInterleave(rrf, ltr, "disjoint");

    expect(merged.length).toBe(4);
    expect(new Set(merged)).toEqual(new Set(["a", "b", "c", "d"]));

    // Items unique to one list are placed by their owning arm
    for (let i = 0; i < merged.length; i++) {
      if (rrf.includes(merged[i]!)) {
        expect(armBySlot[i]).toBe("rrf");
      }
      if (ltr.includes(merged[i]!)) {
        expect(armBySlot[i]).toBe("ltr");
      }
    }
  });

  it("handles single-item lists", () => {
    const r1 = teamDraftInterleave(["x"], [], "single");
    expect(r1.merged).toEqual(["x"]);
    expect(r1.armBySlot).toEqual(["rrf"]);

    const r2 = teamDraftInterleave([], ["y"], "single");
    expect(r2.merged).toEqual(["y"]);
    expect(r2.armBySlot).toEqual(["ltr"]);
  });

  it("handles empty lists", () => {
    const { merged, armBySlot } = teamDraftInterleave([], [], "empty");
    expect(merged).toEqual([]);
    expect(armBySlot).toEqual([]);
  });

  it("respects team balance", () => {
    // Disjoint lists avoid shared-item complications
    const rrf = ["r1", "r2", "r3", "r4", "r5"];
    const ltr = ["l1", "l2", "l3", "l4", "l5"];

    const { armBySlot } = teamDraftInterleave(rrf, ltr, "balance");

    let rrfCount = 0;
    let ltrCount = 0;

    for (const arm of armBySlot) {
      // The team with fewer members must pick next; ties are PRNG
      if (rrfCount < ltrCount) {
        expect(arm).toBe("rrf");
      } else if (ltrCount < rrfCount) {
        expect(arm).toBe("ltr");
      }

      if (arm === "rrf") rrfCount++;
      else ltrCount++;
    }

    // Equal-size disjoint lists end perfectly balanced
    expect(rrfCount).toBe(5);
    expect(ltrCount).toBe(5);
  });
});
