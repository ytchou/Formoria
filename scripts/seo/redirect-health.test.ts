import { describe, expect, it } from "vitest";
import {
  auditBrandRedirects,
  blockingFindingCount,
  type BrandStatusRow,
  type RedirectRow,
} from "./redirect-health";

const brands: BrandStatusRow[] = [
  { slug: "keizu", status: "approved" },
  { slug: "halfor", status: "approved" },
  { slug: "colorsmith", status: "hidden" },
];

function audit(redirects: RedirectRow[], override = brands) {
  return auditBrandRedirects(redirects, override);
}

describe("auditBrandRedirects", () => {
  it("passes a healthy single-hop redirect", () => {
    const result = audit([{ old_slug: "keizu-好鞋好設計", new_slug: "keizu" }]);

    expect(blockingFindingCount(result)).toBe(0);
    expect(result.dormant).toHaveLength(0);
  });

  it("flags a target with no brand row as a redirect into a 404", () => {
    const result = audit([{ old_slug: "gone", new_slug: "also-gone" }]);

    expect(result.missingTargets).toHaveLength(1);
    expect(blockingFindingCount(result)).toBe(1);
  });

  it("flags a chained hop", () => {
    const result = audit([
      { old_slug: "a", new_slug: "b" },
      { old_slug: "b", new_slug: "keizu" },
    ]);

    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]?.oldSlug).toBe("a");
    expect(blockingFindingCount(result)).toBe(1);
  });

  it("detects a two-row loop", () => {
    const result = audit([
      { old_slug: "a", new_slug: "b" },
      { old_slug: "b", new_slug: "a" },
    ]);

    expect(result.cycles).toHaveLength(2);
    expect(blockingFindingCount(result)).toBeGreaterThan(0);
  });

  // A single-step check reads A->B->C->A as an ordinary chain and never reports
  // the loop, which is the failure Googlebot actually gives up on.
  it("detects a loop that closes only after several hops", () => {
    const result = audit([
      { old_slug: "a", new_slug: "b" },
      { old_slug: "b", new_slug: "c" },
      { old_slug: "c", new_slug: "a" },
    ]);

    expect(result.cycles.length).toBeGreaterThan(0);
  });

  // The resolver joins on status='approved', so these rows are inert, not
  // broken — deleting them would discard a correct mapping.
  it("reports a hidden target as dormant rather than blocking", () => {
    const result = audit([
      { old_slug: "colorsmith-台灣原創品包包品牌", new_slug: "colorsmith" },
    ]);

    expect(result.dormant).toHaveLength(1);
    expect(result.missingTargets).toHaveLength(0);
    expect(blockingFindingCount(result)).toBe(0);
  });

  it("returns an empty audit for an empty table", () => {
    const result = audit([]);

    expect(blockingFindingCount(result)).toBe(0);
    expect(result.dormant).toHaveLength(0);
  });
});
