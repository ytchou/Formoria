import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MATERIALS, subcategoryBySlug } from "@/lib/taxonomy/ontology";
import type { EnrichBrand, EnrichPhase } from "../types";
import type { ProductsSupabase } from "../products";
import { runProductsPhase, validateProductProposals } from "../products";

/**
 * The LLM call is the only thing stubbed. `createProfiledOpenAIClient` lives in
 * `../../llm-audit`, and the mock is registered on the RELATIVE path on purpose:
 * `check:test-boundaries` (run by `pnpm lint`) fails a test that mocks
 * `@/lib/services/*`, `@/lib/supabase/*` or `@supabase/*`, and this test mocks
 * neither Supabase nor a service the phase's own logic lives in. The Supabase
 * client is INJECTED instead of mocked, which is also what lets the
 * zero-writes assertion below observe every table the phase touches.
 *
 * `site-identity.test.ts` mocks `../../site-identity-arbiter` the same way.
 */
const createClient = vi.hoisted(() => vi.fn());
vi.mock("../../llm-audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../llm-audit")>()),
  createProfiledOpenAIClient: createClient,
}));

const SITE = "https://island-studio.example";
const SUBMISSION_ID = "3f7c1c4e-0b2a-4a9d-9a5a-2c8e1d4b6f01";
const PHASES = ["descriptions", "faq", "products"] as EnrichPhase[];

const BRAND: EnrichBrand = {
  id: SUBMISSION_ID,
  slug: "island-studio",
  name: "小島工坊",
  category: "home",
  purchase_website: SITE,
};

const SCRAPED = {
  description: "以南投陶土製作日用器皿。",
  snippets: ["小島工坊 手拉坏餐具"],
  perSourceText: {
    [`${SITE}/products/clay-plate`]: {
      title: "陶土餐盤",
      description: "南投陶土手拉坏，直徑 21 公分。",
    },
    [`${SITE}/products/tea-cup`]: {
      title: "品茗杯",
      description: "柴燒品茗杯，容量 80ml。",
    },
    [SITE]: { title: "小島工坊", description: "關於我們" },
  },
  imageSources: [
    {
      url: `${SITE}/img/plate.jpg`,
      method: "crawl",
      pageUrl: `${SITE}/products/clay-plate`,
      position: 0,
    },
  ],
};

type RawProposal = Record<string, unknown>;

function rawProposal(overrides: RawProposal = {}): RawProposal {
  return {
    name_zh: "陶土餐盤",
    name_en: "Clay Plate",
    category: "home",
    subcategories: ["餐具"],
    material: ["ceramic"],
    official_url: `${SITE}/products/clay-plate`,
    image_source_url: `${SITE}/products/clay-plate`,
    product_description_zh: "南投陶土手拉坏，直徑 21 公分，適合日常盛裝主餐。",
    sources: [
      {
        url: `${SITE}/products/clay-plate`,
        source_type: "official",
        claim_zh: "商品頁列出陶土與尺寸",
      },
    ],
    ...overrides,
  };
}

function modelReturns(products: RawProposal[]) {
  const chat = vi.fn().mockResolvedValue({
    response: { ok: true },
    content: JSON.stringify({ products }),
  });
  createClient.mockReturnValue({ chat });
  return chat;
}

type FakeQuery = {
  select: () => FakeQuery;
  eq: () => FakeQuery;
  order: () => FakeQuery;
  limit: () => Promise<{ data: unknown[]; error: null }>;
  insert: () => FakeQuery;
  upsert: () => FakeQuery;
};

/**
 * Records every table the phase reaches for, so "wrote no rows" is asserted
 * against observed behaviour rather than against the absence of an import.
 */
function injectedSupabase(rows: unknown[] = []) {
  const tables: string[] = [];
  const writes: string[] = [];
  const chain: FakeQuery = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: async () => ({ data: rows, error: null }),
    insert: () => {
      writes.push("insert");
      return chain;
    },
    upsert: () => {
      writes.push("upsert");
      return chain;
    },
  };
  const client = {
    from: (table: string) => {
      tables.push(table);
      return chain;
    },
  } as unknown as ProductsSupabase;
  return { client, tables, writes };
}

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  createClient.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runProductsPhase", () => {
  it("skips_when_phase_not_requested", async () => {
    const result = await runProductsPhase({
      brand: BRAND,
      phases: ["descriptions", "faq"] as EnrichPhase[],
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.phaseResult.status).toBe("skipped");
    expect(result.phaseResult.detail).toBe("products phase not requested");
    // The guard is the FIRST line: no client is built, so no call is billed.
    expect(createClient).not.toHaveBeenCalled();
    expect(result.patch).toEqual({});
    expect(result.proposals).toEqual([]);
  });

  it("writes_no_rows_for_submission_targets", async () => {
    modelReturns([
      rawProposal(),
      rawProposal({
        name_zh: "柴燒品茗杯",
        name_en: "Wood-fired Tea Cup",
        official_url: `${SITE}/products/tea-cup`,
        image_source_url: `${SITE}/products/tea-cup`,
        product_description_zh: "柴燒品茗杯，容量 80ml，杯口外翻便於聞香。",
        sources: [
          {
            url: `${SITE}/products/tea-cup`,
            source_type: "official",
            claim_zh: "商品頁列出容量",
          },
        ],
      }),
    ]);
    const { client, tables, writes } = injectedSupabase();

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
      supabase: client,
    });

    expect(result.phaseResult.status).toBe("succeeded");
    expect(result.proposals).toHaveLength(2);
    // The proposals ride the patch, which becomes `enriched_data.products[]`.
    expect(result.patch.products).toHaveLength(2);
    expect(result.phaseResult.changedFields).toEqual(["products"]);
    // Materialization is the moderator's approval, not the enrichment run's.
    expect(tables).not.toContain("curated_products");
    expect(tables).not.toContain("curated_product_sources");
    expect(writes).toEqual([]);
    // snake_case in, camelCase out — transformed at the service boundary.
    expect(result.proposals[0]).toMatchObject({
      nameZh: "陶土餐盤",
      nameEn: "Clay Plate",
      category: "home",
      subcategories: ["tableware"],
      material: ["ceramic"],
      officialUrl: `${SITE}/products/clay-plate`,
      productDescriptionZh:
        "南投陶土手拉坏，直徑 21 公分，適合日常盛裝主餐。",
    });
    expect(result.proposals[0]!.key).toBeTruthy();
    expect(result.proposals[0]!.sources[0]).toMatchObject({
      url: `${SITE}/products/clay-plate`,
      sourceType: "official",
    });
  });

  it("reads_the_patched_official_site", async () => {
    const chat = modelReturns([]);

    await runProductsPhase({
      brand: { ...BRAND, purchase_website: "https://stale.example" },
      phases: PHASES,
      scrapedData: null,
      pendingPatch: { purchase_website: SITE },
      target: { type: "submission", id: SUBMISSION_ID },
      supabase: injectedSupabase().client,
    });

    const user = chat.mock.calls[0]![0].user as string;
    expect(user).toContain(SITE);
    expect(user).not.toContain("https://stale.example");
  });

  it("does not scrape a site this run revoked", async () => {
    // site-identity strikes a contaminated `purchase_website` by naming it in the
    // patch's `_cleared_fields` sentinel. Reading the pre-run brand snapshot
    // instead would send the phase at a stranger's shop.
    const chat = modelReturns([]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      pendingPatch: { _cleared_fields: ["purchase_website"] },
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.phaseResult.status).toBe("skipped");
    expect(chat).not.toHaveBeenCalled();
  });

  it("emits_no_proposal_without_a_source_url", async () => {
    modelReturns([
      rawProposal({ name_zh: "無來源餐盤", sources: [] }),
      rawProposal({
        name_zh: "壞來源餐盤",
        sources: [{ url: "javascript:alert(1)", source_type: "official" }],
      }),
      rawProposal({ name_zh: "缺來源欄位餐盤", sources: undefined }),
      rawProposal(),
    ]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.nameZh).toBe("陶土餐盤");
    // Never repaired from `official_url`: a proposal cites the page it was read
    // from, and inventing that citation is what the drop exists to prevent.
    expect(result.proposals.map((proposal) => proposal.nameZh)).not.toContain(
      "無來源餐盤",
    );
    expect(result.phaseResult.detail).toContain("dropped 3");
  });

  it("caps_proposals_per_brand", async () => {
    modelReturns(
      Array.from({ length: 8 }, (_, index) =>
        rawProposal({
          name_zh: `陶土餐盤 ${index + 1}`,
          official_url: `${SITE}/products/clay-plate-${index + 1}`,
          sources: [
            {
              url: `${SITE}/products/clay-plate-${index + 1}`,
              source_type: "official",
            },
          ],
        }),
      ),
    );

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.proposals).toHaveLength(5);
    expect(result.patch.products).toHaveLength(5);
    expect(new Set(result.proposals.map((proposal) => proposal.key)).size).toBe(5);
  });

  it("reports a provider failure instead of an empty success", async () => {
    // The 2026-08-02 shape: every call 429s, the phase reports `succeeded`, and a
    // brand with no proposals is indistinguishable from a brand with none found.
    createClient.mockReturnValue({
      chat: vi.fn().mockResolvedValue({ response: { ok: false }, content: null }),
    });

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.phaseResult.status).toBe("failed");
    expect(result.phaseResult.providerFailure).toBe(true);
    expect(result.patch).toEqual({});
  });

  it("runs only for submission targets", async () => {
    // A brand-target patch is applied column by column to `brands`, which has no
    // `products` column, so carrying proposals there would 42703 the whole
    // update and take every other phase's field down with it.
    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "brand", id: BRAND.id },
    });

    expect(result.phaseResult.status).toBe("skipped");
    expect(createClient).not.toHaveBeenCalled();
    expect(result.patch).toEqual({});
  });
});

describe("validateProductProposals", () => {
  it("drops a material outside the closed vocabulary", () => {
    const { proposals, dropped } = validateProductProposals(
      { products: [rawProposal({ material: ["ceramic", "plastic", "陶瓷"] })] },
      { siteUrl: SITE },
    );

    expect(dropped).toBe(0);
    // Slug-only, because `createCuratedProduct` resolves material by slug and
    // silently drops a Chinese label — the prompt promises this, so the phase
    // has to enforce it rather than quietly repair it.
    expect(proposals[0]!.material).toEqual(["ceramic"]);
    expect(MATERIALS.map((material) => material.slug)).toContain("ceramic");
  });

  it("drops a subcategory the ontology cannot resolve", () => {
    const { proposals } = validateProductProposals(
      { products: [rawProposal({ subcategories: ["馬克杯", "餐具", "bedding"] })] },
      { siteUrl: SITE },
    );

    // Chinese label, ontology slug, and a novel label: the first two resolve,
    // the novel one is dropped rather than stored as a dead filter value.
    expect(proposals[0]!.subcategories).toEqual(["tableware", "bedding"]);
    expect(subcategoryBySlug("tableware")?.category).toBe("home");
  });

  it("drops a subcategory belonging to another L1 branch", () => {
    const { proposals } = validateProductProposals(
      { products: [rawProposal({ subcategories: ["托特包"] })] },
      { siteUrl: SITE },
    );

    expect(proposals[0]!.subcategories).toEqual([]);
  });

  it("drops a proposal whose category is not an L1 slug", () => {
    const { proposals, dropped } = validateProductProposals(
      {
        products: [
          rawProposal({ category: null }),
          rawProposal({ category: "homeware" }),
        ],
      },
      { siteUrl: SITE },
    );

    expect(proposals).toEqual([]);
    expect(dropped).toBe(2);
  });

  it("drops a homepage or off-site official_url", () => {
    const { proposals, dropped } = validateProductProposals(
      {
        products: [
          rawProposal({ name_zh: "首頁", official_url: `${SITE}/` }),
          rawProposal({
            name_zh: "社群",
            official_url: "https://www.instagram.com/island.studio",
          }),
          rawProposal(),
        ],
      },
      { siteUrl: SITE },
    );

    expect(dropped).toBe(2);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.officialUrl).toBe(`${SITE}/products/clay-plate`);
  });

  it("carries no commerce field, whatever the model returns", () => {
    const { proposals } = validateProductProposals(
      {
        products: [
          rawProposal({
            price: 580,
            price_range: 2,
            availability: "in stock",
            variants: ["S", "M"],
            offers: { price: 580 },
          }),
        ],
      },
      { siteUrl: SITE },
    );

    const keys = Object.keys(proposals[0]!);
    for (const forbidden of [
      "price",
      "priceRange",
      "price_range",
      "availability",
      "stock",
      "inventory",
      "discount",
      "variants",
      "offers",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("keeps a source with an unknown type by filing it as other", () => {
    const { proposals } = validateProductProposals(
      {
        products: [
          rawProposal({
            sources: [
              { url: `${SITE}/products/clay-plate`, source_type: "brand-blog" },
            ],
          }),
        ],
      },
      { siteUrl: SITE },
    );

    // The URL is the load-bearing half of a citation; the CHECK list is not
    // something the model can be trusted to spell, and `other` is a truthful
    // fallback that keeps the evidence.
    expect(proposals[0]!.sources[0]!.sourceType).toBe("other");
  });
});
