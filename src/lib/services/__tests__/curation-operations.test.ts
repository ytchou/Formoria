import { describe, expect, it, vi } from "vitest";
import {
  applyChunkNameCleanup,
  processEnrichBrand,
  mapWithConcurrency,
  mergeEnrichPatches,
  mergeSubmissionEnrichedData,
  persistEnrichmentResults,
  needsPhase,
  seedEnrichedDataFromOwnerData,
  submissionToEnrichBrand,
} from "../curation-operations";
import type { CurationConfig } from "../curation-operations";
import {
  enrichedDataFromDb,
  enrichedDataToDb,
} from "@/lib/types/enriched-data";
import type { CuratedProductProposal } from "@/lib/types/enriched-data";
import { getDisplayBrandName, runCleanPhase } from "../enrich-phases";

vi.mock("../category-classifier", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../category-classifier")>();
  return {
    ...actual,
    detectBrandsBatch: vi.fn(),
  };
});

describe("bounded enrichment concurrency", () => {
  it("runs multiple targets concurrently without exceeding the limit or reordering results", async () => {
    const targets = [
      "森雨製作所",
      "Lumière Atelier",
      "María García Ceramics",
      "Formoria",
    ];
    let activeTargets = 0;
    let maxActiveTargets = 0;

    const results = await mapWithConcurrency(
      targets,
      3,
      async (target, index) => {
        activeTargets += 1;
        maxActiveTargets = Math.max(maxActiveTargets, activeTargets);
        await new Promise((resolve) =>
          setTimeout(resolve, (targets.length - index) * 10),
        );
        activeTargets -= 1;
        return target;
      },
    );

    expect(maxActiveTargets).toBe(3);
    expect(results).toEqual(targets);
  });
});

describe("seedEnrichedDataFromOwnerData", () => {
  it("seeds enriched_data fields from owner_data", () => {
    const ownerData = {
      categorySlug: "bags-accessories",
      foundingYear: 2018,
      city: "tainan",
      subcategories: ["leather", "handmade"],
    };
    const result = seedEnrichedDataFromOwnerData(ownerData, null);
    expect(result).toMatchObject({
      category: "bags-accessories",
      founding_year: 2018,
      city: "tainan",
      subcategories: ["leather", "handmade"],
    });
  });

  it("does not overwrite existing enriched_data fields", () => {
    const ownerData = {
      categorySlug: "bags-accessories",
      city: "tainan",
    };
    const existingEnriched = {
      category: "fashion",
      description: "Existing description",
    };
    const result = seedEnrichedDataFromOwnerData(ownerData, existingEnriched);
    expect(result.category).toBe("fashion");
    expect(result.city).toBe("tainan");
    expect(result.description).toBe("Existing description");
  });

  it("returns existing enriched_data when owner_data is null", () => {
    const existing = { description: "Hello" };
    const result = seedEnrichedDataFromOwnerData(null, existing);
    expect(result).toEqual(existing);
  });

  it("returns empty object when both are null", () => {
    const result = seedEnrichedDataFromOwnerData(null, null);
    expect(result).toEqual({});
  });
});

describe("mergeSubmissionEnrichedData", () => {
  it("replaces and caps subcategory pairs instead of accumulating rerun outputs", () => {
    const result = mergeSubmissionEnrichedData(
      {
        subcategories: ["既有一", "既有二", "既有三"],
        subcategories_en: ["Existing 1", "Existing 2", "Existing 3"],
      },
      {
        subcategories: ["新一", "新二", "新三", "新四", "新五", "新六"],
        subcategories_en: [
          "New 1",
          "New 2",
          "New 3",
          "New 4",
          "New 5",
          "New 6",
        ],
      },
    );

    expect(result.subcategories).toEqual([
      "新一",
      "新二",
      "新三",
      "新四",
      "新五",
    ]);
    expect(result.subcategories_en).toEqual([
      "New 1",
      "New 2",
      "New 3",
      "New 4",
      "New 5",
    ]);
  });

  // A union would make the first clear permanent: the run that finally finds a
  // real reputation could never take the field back off the cleared list.
  it("replaces rather than unions _cleared_fields", () => {
    const result = mergeSubmissionEnrichedData(
      { _cleared_fields: ["reputation_summary"] },
      { _cleared_fields: ["city"] },
    );

    expect(result._cleared_fields).toEqual(["city"]);
  });

  it("drops a cleared field that the same patch gives a value", () => {
    const result = mergeSubmissionEnrichedData(
      {},
      {
        _cleared_fields: ["reputation_summary"],
        reputation_summary: { text: "媒體報導" },
      },
    );

    expect(result.reputation_summary).toEqual({ text: "媒體報導" });
    expect(result).not.toHaveProperty("_cleared_fields");
  });

  // The sentinel is the only way a run can express "this value is gone", so it
  // has to beat whatever an earlier run stored — otherwise the revocation is
  // silently dropped and the stale value keeps being published.
  it("a clear beats a stale base value", () => {
    const result = mergeSubmissionEnrichedData(
      { city: "台北" },
      { _cleared_fields: ["city", "reputation_summary"] },
    );

    expect(result._cleared_fields).toEqual(["city", "reputation_summary"]);
    expect(result).not.toHaveProperty("city");
  });

  it("keeps a clear when the merged value is empty", () => {
    const result = mergeSubmissionEnrichedData(
      { reputation_summary: {} },
      { _cleared_fields: ["reputation_summary"] },
    );

    expect(result._cleared_fields).toEqual(["reputation_summary"]);
  });

  it("preserves a revocation when a later run clears a stored link", () => {
    const firstRun = mergeSubmissionEnrichedData(
      {},
      { purchase_website: "https://smore.com" },
    );
    const secondRun = mergeSubmissionEnrichedData(firstRun, {
      _cleared_fields: ["purchase_website"],
    });

    expect(secondRun).toEqual({ _cleared_fields: ["purchase_website"] });
    expect(secondRun.purchase_website).toBeUndefined();
  });
});

/**
 * The `enriched_data.products[]` payload contract (DEV-1469): the proposals an
 * enrichment run makes ride the submission blob, so the blob's transforms and
 * its rerun merge are the two places a proposal can be silently corrupted.
 */
describe("enriched_data.products[] payload contract", () => {
  const proposal = (key: string): CuratedProductProposal => ({
    key,
    nameZh: `${key} 陶杯`,
    nameEn: `${key} cup`,
    category: "home-living",
    subcategories: ["tableware"],
    material: ["ceramic"],
    officialUrl: `https://example.com/products/${key}`,
    imageSourceUrl: `https://example.com/products/${key}#photo`,
    productDescriptionZh: "杯口收窄，握起來剛好一手。",
    sources: [
      {
        url: `https://example.com/products/${key}`,
        sourceType: "official",
        claimZh: "官網產品頁",
      },
    ],
  });

  // Object arrays inside the blob are camelCase passthrough (the `channels`
  // precedent), so a round trip has to be lossless in BOTH directions — a
  // one-sided transform would drop every proposal on the next read.
  it("products_survive_the_db_round_trip", () => {
    const input = { products: [proposal("a"), proposal("b")] };

    const stored = enrichedDataToDb(input);
    expect(stored.products).toEqual(input.products);

    expect(enrichedDataFromDb(stored)).toEqual(input);
  });

  // deepMergeJsonObjects unions arrays through a Set, which is a no-op on
  // object arrays: every rerun would append its proposals to the stored ones
  // and the moderator would review 5 rows for a 2-product brand.
  it("products_merge_replaces_not_unions", () => {
    const base = { products: [proposal("a"), proposal("b"), proposal("c")] };
    const patch = { products: [proposal("d"), proposal("e")] };

    const merged = mergeSubmissionEnrichedData(base, patch);

    expect(merged.products).toEqual(patch.products);
    expect(merged.products).toHaveLength(2);
    expect(
      (merged.products as CuratedProductProposal[]).map(
        (product) => product.key,
      ),
    ).toEqual(["d", "e"]);
  });

  // An empty array is not the same statement as silence: `products: []` reads as
  // "this run found nothing" and would wipe a stored proposal set, so a payload
  // that never mentions products must not grow the key.
  it("products_absent_stays_absent", () => {
    const stored = enrichedDataToDb({ description: "品牌介紹" });
    expect(stored).not.toHaveProperty("products");

    const read = enrichedDataFromDb({ description: "品牌介紹" });
    expect(read).not.toHaveProperty("products");

    const merged = mergeSubmissionEnrichedData(
      { products: [proposal("a")] },
      { description: "品牌介紹" },
    );
    expect(merged.products).toEqual([proposal("a")]);
  });

  // Commerce truth is excluded from the graph forever. The key list is typed as
  // an exhaustive record, so adding a field to CuratedProductProposal fails to
  // compile until it is named here — and then this scan is what rejects it.
  it("payload_carries_no_commerce_fields", () => {
    const fields: Record<keyof CuratedProductProposal, true> = {
      key: true,
      nameZh: true,
      nameEn: true,
      category: true,
      subcategories: true,
      material: true,
      officialUrl: true,
      imageSourceUrl: true,
      productDescriptionZh: true,
      sources: true,
      madeInTaiwanConfirmed: true,
      materialsFromTaiwanConfirmed: true,
      mitRegistryId: true,
      originCandidateId: true,
    };

    const forbidden =
      /price|cost|stock|inventory|discount|availab|offer|variant|sku|currency|checkout/i;
    const proposalKeys = Object.keys(fields);
    expect(proposalKeys.filter((field) => forbidden.test(field))).toEqual([]);

    const sourceFields: Record<
      keyof CuratedProductProposal["sources"][number],
      true
    > = { url: true, sourceType: true, claimZh: true };
    expect(Object.keys(sourceFields).filter((f) => forbidden.test(f))).toEqual(
      [],
    );

    // And no runtime key survives the transforms either.
    const stored = enrichedDataToDb({ products: [proposal("a")] });
    const storedKeys = (stored.products as CuratedProductProposal[]).flatMap(
      (product) => Object.keys(product),
    );
    expect(storedKeys.filter((field) => forbidden.test(field))).toEqual([]);
  });
});

describe("processEnrichBrand", () => {
  const baseBrand = {
    id: "1",
    slug: "mybrand",
    display_brand_name: "My Brand",
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    purchase_pinkoi: null,
    purchase_shopee: null,
    website_url: null,
    description: null,
    hero_image_url: null,
    product_images: [],
  };

  const scrapedData = {
    social_instagram: "https://www.instagram.com/mybrand/",
    social_facebook: "https://www.facebook.com/mybrand",
    description:
      "A premium handcrafted brand from Taiwan specializing in leather goods",
    story: "Founded in 2015 by artisans in Tainan",
  };

  it("enriches brand with social links from scraped data", () => {
    const result = processEnrichBrand(baseBrand, scrapedData, ["links"]);
    expect(result.patches.links?.social_instagram).toBe(
      "https://www.instagram.com/mybrand/",
    );
  });

  it("does not write scraped description directly into patch (LLM rewrite path only)", () => {
    const result = processEnrichBrand(baseBrand, scrapedData, ["descriptions"]);
    // Scraped text is junk — description is only populated via the LLM rewrite pipeline,
    // so buildTextEnrichPatch returns empty and the patch key is absent.
    expect(result.patches.descriptions).toBeUndefined();
  });

  it("omits description when phase is not requested", () => {
    const result = processEnrichBrand(baseBrand, scrapedData, ["links"]);
    expect(result.patches.descriptions).toBeUndefined();
  });
});

describe("enrichment write guards", () => {
  it("rejects the retired direct-to-live brand write path", async () => {
    await expect(
      persistEnrichmentResults(
        {} as never,
        [{ brandId: "b1", patch: { city: "台南" } }],
        "job-1",
      ),
    ).rejects.toThrow("Direct brand enrichment is retired");
  });

  it("derives overwrite behavior from refresh intent and seeds the base snapshot", () => {
    const refresh = submissionToEnrichBrand({
      id: "submission-1",
      brand_id: "brand-1",
      intent: "refresh",
      base_brand_data: {
        name: "Live name",
        city: "台南",
      },
      brand_name: "Legacy row name",
      description: null,
      website_url: null,
      hero_image_url: null,
      social_instagram: null,
      social_threads: null,
      social_facebook: null,
      purchase_website: null,
      purchase_pinkoi: null,
      purchase_shopee: null,
      purchase_myship: null,
      other_urls: [],
      enriched_data: {
        city: "台北",
      },
      owner_data: null,
      status: "pending",
    });
    const linkedNonRefresh = submissionToEnrichBrand({
      ...{
        id: "submission-2",
        brand_id: "brand-1",
        intent: "recommend",
        base_brand_data: null,
        brand_name: "Legacy linked",
        description: null,
        website_url: null,
        hero_image_url: null,
        social_instagram: null,
        social_threads: null,
        social_facebook: null,
        purchase_website: null,
        purchase_pinkoi: null,
        purchase_shopee: null,
        purchase_myship: null,
        other_urls: [],
        enriched_data: null,
        owner_data: null,
        status: "pending",
      },
    });

    expect(refresh).toMatchObject({
      name: "Live name",
      city: "台北",
      overwrite_enrichment: true,
    });
    expect(linkedNonRefresh.overwrite_enrichment).toBe(false);
  });

  it("per-field gate: brand with enriched_at set but missing description is still selected for the descriptions phase", () => {
    const brand = {
      brand_enriched_at: "2026-06-01",
      description: null,
      hero_image_url: "x",
    };
    expect(needsPhase(brand, "descriptions")).toBe(true);
  });

  it("selects brands that have Chinese copy but are missing required English copy", () => {
    const brand = {
      description: "既有中文品牌介紹",
      description_en: null,
      blurb_en: null,
    };

    expect(needsPhase(brand, "descriptions")).toBe(true);
  });
});

describe("processEnrichBrand with cleanup phases", () => {
  const baseBrand = {
    id: "1",
    slug: "test-brand",
    display_brand_name: "  ✨ My Brand ✨  ",
    name: "  ✨ My Brand ✨  ",
    status: "approved",
    description: null,
    category: null,
    purchase_website: null,
  };

  it("cleans brand name and returns normalized result", () => {
    const result = processEnrichBrand(baseBrand, {}, ["clean"]);
    expect(result.phases).toHaveProperty("clean");
    expect(result.phases.clean?.changed).toBe(true);
    expect(result.patches.names?.name).toBe("My Brand");
    expect(result.patches).not.toHaveProperty("clean");
    expect(result.patch.name).toBe("My Brand");
  });

  it("preserves original name when clean phase is not requested", () => {
    const result = processEnrichBrand(baseBrand, {}, ["discover"]);
    expect(result.phases).not.toHaveProperty("clean");
  });

  it("clean phase preserves already-clean names", () => {
    const cleanBrand = {
      ...baseBrand,
      name: "Already Clean",
      display_brand_name: "Already Clean",
    };
    const result = processEnrichBrand(cleanBrand, {}, ["clean"]);
    expect(result.phases.clean?.changed).toBe(false);
    expect(result.patch).toEqual({});
  });
});

describe("applyChunkNameCleanup", () => {
  const messyBrand = () => ({
    id: "brand-1",
    slug: "adela",
    name: "adela愛德拉 ｜守護家人，為愛研發",
    status: "approved",
    description: null,
    category: null,
    purchase_website: null,
  });

  it("cleans the name before the batch queries are built", () => {
    const chunk = [messyBrand()];

    applyChunkNameCleanup(chunk);

    // chunkBrandNames is what discover/image-search turn into query strings.
    // Lowercase `adela` survives on purpose: `cleanBrandName` no longer
    // title-cases, because re-casing a name the brand owns is itself a bug
    // (`一屋 1woof` -> `一屋 1Woof`). Casing decisions belong to the arbiter.
    const chunkBrandNames = chunk.map(getDisplayBrandName);
    expect(chunkBrandNames).toEqual(["adela 愛德拉"]);
  });

  it("keeps every batch result map key resolvable after the rename", () => {
    const chunk = [
      messyBrand(),
      { ...messyBrand(), id: "brand-2", slug: "clean", name: "Already Clean" },
    ];

    applyChunkNameCleanup(chunk);

    // Batch phases key their results by the same helper the per-brand loop
    // later reads with, so a rename between the two would be a silent miss.
    const chunkBrandNames = chunk.map(getDisplayBrandName);
    const batchResults = new Map(
      chunkBrandNames.map((name, index) => [name, index]),
    );

    expect(
      chunk.map((brand) => batchResults.get(getDisplayBrandName(brand))),
    ).toEqual([0, 1]);
  });

  it("is idempotent — a second pass reports no further change", () => {
    const chunk = [messyBrand()];

    const first = applyChunkNameCleanup(chunk);
    const second = applyChunkNameCleanup(chunk);

    expect(first.get("brand-1")?.cleanedName).toBe("adela 愛德拉");
    expect(second.size).toBe(0);
    expect(chunk[0]!.name).toBe("adela 愛德拉");
  });

  // The clean phase no longer persists the rename itself (DEV-1321): it emits
  // the cleaned value as the `cleaned` candidate and the names phase writes it.
  it("still surfaces the rename as a candidate from the clean phase", async () => {
    const chunk = [messyBrand()];
    const cleanups = applyChunkNameCleanup(chunk);

    const { phaseResult, cleanedName } = await runCleanPhase(
      chunk[0]!,
      ["clean"],
      cleanups.get("brand-1"),
    );

    expect(phaseResult.changedFields).toEqual(["name"]);
    expect(cleanedName).toBe("adela 愛德拉");
  });

  it("reports no change for a brand that entered already clean", async () => {
    const brand = { ...messyBrand(), name: "Already Clean" };
    const cleanups = applyChunkNameCleanup([brand]);

    const { phaseResult, cleanedName } = await runCleanPhase(
      brand,
      ["clean"],
      cleanups.get("brand-1"),
    );

    expect(phaseResult.changedFields).toEqual([]);
    expect(cleanedName).toBeNull();
  });
});

describe("descriptions phase standalone", () => {
  const baseBrand = {
    id: "1",
    slug: "mybrand",
    display_brand_name: "My Brand",
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    purchase_pinkoi: null,
    purchase_shopee: null,
    website_url: null,
    description: null,
    hero_image_url: null,
    product_images: [],
  };

  it("runs descriptions phase without setting category", () => {
    const result = processEnrichBrand(
      baseBrand,
      { snippets: ["A great brand making handmade soap"] },
      ["descriptions"],
    );
    expect(result.phases).toHaveProperty("descriptions");
    expect(result.patch).not.toHaveProperty("category");
  });

  it("runs descriptions phase without tags when tags is not in phases", () => {
    const result = processEnrichBrand(
      baseBrand,
      { snippets: ["A great brand making handmade soap"] },
      ["descriptions"],
    );
    expect(result.phases).toHaveProperty("descriptions");
    expect(result.phases).not.toHaveProperty("tags");
  });
});

describe("CurationConfig status filter", () => {
  it("constrains status to valid values", () => {
    const config: CurationConfig = { dryRun: true, status: "hidden" };
    expect(config).toHaveProperty("status", "hidden");

    const approved: CurationConfig = { dryRun: false, status: "approved" };
    expect(approved).toHaveProperty("status", "approved");
  });
});

describe("mergeEnrichPatches", () => {
  it("merges link and description patches into single update", () => {
    const patches = {
      links: { social_instagram: "https://www.instagram.com/mybrand/" },
      descriptions: { description: "A new description for the brand" },
    };
    const merged = mergeEnrichPatches(patches);
    expect(merged.social_instagram).toBe("https://www.instagram.com/mybrand/");
    expect(merged.description).toBe("A new description for the brand");
  });

  it("returns empty object when no patches", () => {
    const merged = mergeEnrichPatches({});
    expect(Object.keys(merged)).toHaveLength(0);
  });
});

describe("runEnrich detect integration", () => {
  it("applies non-brand gating — skips tier 3+4 for flagged brands", async () => {
    const { shouldSkipForNonBrand } = await import("../curation-operations");

    const detectResult = {
      isNonBrand: true,
      nonBrandReason: "reseller",
      brandName: null,
      slug: "some-brand",
      slugGenerated: null,
      categorySlug: null,
      confidence: "high" as const,
    };

    expect(shouldSkipForNonBrand(detectResult)).toBe(true);
  });

  it("does not gate brands that are not non-brands", async () => {
    const { shouldSkipForNonBrand } = await import("../curation-operations");

    const detectResult = {
      isNonBrand: false,
      nonBrandReason: null,
      brandName: null,
      slug: "good-brand",
      slugGenerated: "good-brand",
      categorySlug: "beauty",
      confidence: "high" as const,
    };

    expect(shouldSkipForNonBrand(detectResult)).toBe(false);
  });

  it("does not gate low-confidence non-brands", async () => {
    const { shouldSkipForNonBrand } = await import("../curation-operations");

    const detectResult = {
      isNonBrand: true,
      nonBrandReason: "maybe reseller",
      brandName: null,
      slug: "uncertain-brand",
      slugGenerated: null,
      categorySlug: null,
      confidence: "low" as const,
    };

    expect(shouldSkipForNonBrand(detectResult)).toBe(false);
  });
});
