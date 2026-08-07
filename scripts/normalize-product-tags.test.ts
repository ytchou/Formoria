import { describe, expect, it } from "vitest";
import {
  createRunArtifact,
  composeResult,
  parseArgs,
  parseRunArtifact,
  validateResults,
  type BrandRow,
} from "./normalize-product-tags";
import { planTagBackfill } from "@/lib/services/product-tags";

const brand = (overrides: Partial<BrandRow> = {}): BrandRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  slug: "sample-brand",
  product_type: "food",
  product_tags: ["食品禮盒", "側背包", "手工燈籠"],
  product_tags_en: ["Food Gift Box", "Crossbody", "Handmade Lantern"],
  status: "approved",
  ...overrides,
});

describe("normalize-product-tags safety contract", () => {
  it("defaults to planning and requires a reviewed artifact for apply", () => {
    expect(parseArgs([])).toMatchObject({
      apply: false,
      dryRun: true,
      artifactPath: null,
    });
    expect(() => parseArgs(["--apply"])).toThrow(/--artifact/);
    expect(() =>
      parseArgs(["--apply", "--dry-run", "--artifact=run.json"]),
    ).toThrow(/cannot be combined/);
    expect(parseArgs(["--apply", "--artifact=run.json"])).toMatchObject({
      apply: true,
      dryRun: false,
      artifactPath: "run.json",
    });
  });

  it("keeps preserved strategy labels byte-for-byte and retains their EN pair", () => {
    const current = brand();
    const result = composeResult(
      current,
      planTagBackfill(current.product_tags ?? []),
      new Map([["手工燈籠", null]]),
    );

    expect(result.afterZh).toContain("食品禮盒");
    expect(result.afterEn[result.afterZh.indexOf("食品禮盒")]).toBe(
      "Food Gift Box",
    );
    expect(result.perTagSource.get("食品禮盒")).toBe("preserved");
  });

  it("rejects plans that would remove every tag or exceed the five-tag cap", () => {
    const noTags = composeResult(
      brand({ product_tags: ["襪"], product_tags_en: ["Sock"] }),
      planTagBackfill(["襪"]),
      new Map([["襪", null]]),
    );
    expect(() => validateResults([noTags])).toThrow(/zero tags/);

    const sixTags = brand({
      product_tags: [
        "托特包",
        "後背包",
        "斜背包",
        "手提包",
        "水桶包",
        "零錢包",
      ],
      product_tags_en: null,
    });
    const capped = composeResult(
      sixTags,
      planTagBackfill(sixTags.product_tags ?? []),
      new Map(),
    );
    expect(capped.afterZh).toHaveLength(5);
    expect(() => validateResults([capped])).not.toThrow();
  });

  it("serializes paired before/after values and a concrete restoration snapshot", () => {
    const current = brand();
    const result = composeResult(
      current,
      planTagBackfill(current.product_tags ?? []),
      new Map([["手工燈籠", null]]),
    );
    const artifact = createRunArtifact([result], "2026-08-07T00:00:00.000Z");

    expect(artifact.rows[0]?.before.pairs).toEqual([
      { zh: "食品禮盒", en: "Food Gift Box" },
      { zh: "側背包", en: "Crossbody" },
      { zh: "手工燈籠", en: "Handmade Lantern" },
    ]);
    expect(artifact.rows[0]?.after.pairs).toEqual([
      { zh: "食品禮盒", en: "Food Gift Box" },
      { zh: "斜背包", en: "Crossbody Bags" },
      { zh: "手工燈籠", en: "Handmade Lantern" },
    ]);
    expect(artifact.rollback.rows[0]).toMatchObject({
      id: current.id,
      slug: current.slug,
      productTags: current.product_tags,
      productTagsEn: current.product_tags_en,
    });
    expect(() => parseRunArtifact(artifact, { requireApproval: true })).toThrow(
      /review/i,
    );

    const approved = structuredClone(artifact);
    approved.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-07T01:00:00.000Z",
    };
    expect(
      parseRunArtifact(approved, { requireApproval: true }).review,
    ).toEqual(approved.review);
  });

  it("rejects malformed paired values before an apply can start", () => {
    const current = brand();
    const result = composeResult(
      current,
      planTagBackfill(current.product_tags ?? []),
      new Map([["手工燈籠", null]]),
    );
    const artifact = createRunArtifact([result], "2026-08-07T00:00:00.000Z");
    const malformed = structuredClone(artifact);
    malformed.rows[0]!.after.pairs[0]!.zh = "tampered";

    expect(() => parseRunArtifact(malformed)).toThrow(/paired|after/i);
  });
});
