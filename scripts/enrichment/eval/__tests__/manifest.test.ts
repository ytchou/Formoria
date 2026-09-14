import { describe, expect, it } from "vitest";

import {
  loadEvalManifest,
  parseEvalManifest,
  selectSlugs,
} from "../manifest";

// ---------------------------------------------------------------------------
// loadEvalManifest — dev-1689-eval.json
// ---------------------------------------------------------------------------

describe("loadEvalManifest — dev-1689-eval", () => {
  it("loads 30 slugs, all opt10 or opt20, all with non-null expected", async () => {
    const manifest = await loadEvalManifest("dev-1689-eval");

    expect(manifest.slugs).toHaveLength(30);
    expect(manifest.name).toBe("dev-1689-eval");

    for (const slug of manifest.slugs) {
      const entry = manifest.eval[slug];
      expect(["opt10", "opt20"]).toContain(entry.group);
      expect(entry.expected).not.toBeNull();
    }
  });

  it("eval keys match labels keys in both directions", async () => {
    const manifest = await loadEvalManifest("dev-1689-eval");

    const labelKeys = new Set(Object.keys(manifest.labels));
    const evalKeys = new Set(Object.keys(manifest.eval));

    expect(labelKeys).toEqual(evalKeys);
  });
});

// ---------------------------------------------------------------------------
// loadEvalManifest — dev-1689-holdout.json
// ---------------------------------------------------------------------------

describe("loadEvalManifest — dev-1689-holdout", () => {
  it("loads 10 slugs, all holdout group, all expected set post-reveal, holdout:true", async () => {
    const manifest = await loadEvalManifest("dev-1689-holdout");

    expect(manifest.slugs).toHaveLength(10);
    expect(manifest.holdout).toBe(true);

    for (const slug of manifest.slugs) {
      const entry = manifest.eval[slug];
      expect(entry.group).toBe("holdout");
      expect(["success_products", "correct_zero"]).toContain(entry.expected);
    }
  });
});

// ---------------------------------------------------------------------------
// selectSlugs
// ---------------------------------------------------------------------------

describe("selectSlugs", () => {
  it("filters by tags", async () => {
    const manifest = await loadEvalManifest("dev-1689-eval");

    const pinkoi = selectSlugs(manifest, { tags: ["pinkoi"] });
    expect(pinkoi.length).toBeGreaterThan(0);

    // Every returned slug must have the pinkoi tag
    for (const slug of pinkoi) {
      expect(manifest.eval[slug].tags).toContain("pinkoi");
    }
  });

  it("returns all slugs when no filter is given", async () => {
    const manifest = await loadEvalManifest("dev-1689-eval");
    const all = selectSlugs(manifest, {});
    expect(all).toHaveLength(30);
  });

  it("throws on unknown slug", async () => {
    const manifest = await loadEvalManifest("dev-1689-eval");
    expect(() => selectSlugs(manifest, { slugs: ["nonexistent-brand"] })).toThrow(
      "unknown slug",
    );
  });

  it("intersects slugs and tags", async () => {
    const manifest = await loadEvalManifest("dev-1689-eval");

    // Pick two slugs we know about, filter by a tag only one of them has
    const result = selectSlugs(manifest, {
      slugs: ["agape", "taiwan-dye"],
      tags: ["no_catalog"],
    });
    // taiwan-dye has no_catalog, agape does not
    expect(result).toContain("taiwan-dye");
    expect(result).not.toContain("agape");
  });
});

// ---------------------------------------------------------------------------
// parseEvalManifest — validation
// ---------------------------------------------------------------------------

describe("parseEvalManifest — validation", () => {
  it("rejects invalid tags", () => {
    const raw = {
      name: "test",
      title: "t",
      subtitle: "s",
      labels: { foo: "Foo" },
      eval: {
        foo: {
          group: "opt10",
          tags: ["invalid_tag_xyz"],
          expected: null,
          evidence: null,
        },
      },
    };
    expect(() => parseEvalManifest(raw)).toThrow("invalid tag");
  });

  it("rejects eval key mismatch (extra in eval)", () => {
    const raw = {
      name: "test",
      title: "t",
      subtitle: "s",
      labels: { foo: "Foo" },
      eval: {
        foo: { group: "opt10", tags: [], expected: null, evidence: null },
        bar: { group: "opt10", tags: [], expected: null, evidence: null },
      },
    };
    expect(() => parseEvalManifest(raw)).toThrow("missing from labels");
  });

  it("rejects missing evidence when expected is set", () => {
    const raw = {
      name: "test",
      title: "t",
      subtitle: "s",
      labels: { foo: "Foo" },
      eval: {
        foo: {
          group: "opt10",
          tags: [],
          expected: "success_products",
          evidence: null,
        },
      },
    };
    expect(() => parseEvalManifest(raw)).toThrow("evidence is required");
  });

  it("validates all tags belong to the TAGS set", async () => {
    const manifest = await loadEvalManifest("dev-1689-eval");

    const VALID_TAGS: Set<string> = new Set([
      "own_site", "pinkoi", "shopee", "myship", "multi_channel",
      "marketplace_only", "custom_domain", "hosted_storefront",
      "www_non_www", "subdomain", "locale_path", "deep_category_path",
      "redirect", "js_render", "crawler_block", "single_listing",
      "no_catalog", "bad_source_url", "existing_products",
    ]);

    for (const slug of manifest.slugs) {
      for (const tag of manifest.eval[slug].tags) {
        expect(VALID_TAGS.has(tag as string)).toBe(true);
      }
    }
  });
});
