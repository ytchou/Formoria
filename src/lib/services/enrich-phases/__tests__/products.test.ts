import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { MATERIALS, subcategoryBySlug } from "@/lib/taxonomy/ontology";
import type { EnrichBrand, EnrichPhase } from "../types";
import { runProductsPhase, validateProductProposals } from "../products";
import type { ProductCandidate } from "../product-candidates";

/**
 * The LLM call is the only thing stubbed. `createProfiledOpenAIClient` is a
 * PROVIDER-CLIENT FACTORY — the adapter seam in front of OpenAI — so stubbing it
 * replaces the network, not the phase: every accept/drop rule under test still
 * runs for real. It does live in `src/lib/services/llm-audit.ts`, which is a
 * service module; `check:test-boundaries` (run by `pnpm lint`) matches the
 * `@/lib/services/` alias spelling only, so the relative path below passes the
 * gate. That is a gap in the gate, filed separately, and NOT the licence this
 * test relies on: the reason the mock is legitimate is that the mocked export
 * is the adapter, and `site-identity.test.ts` stubs `../../site-identity-arbiter`
 * on the same ground.
 *
 * Supabase is INJECTED rather than mocked, which is also what lets the
 * zero-writes assertion below observe every table the phase touches.
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
  source_brand_id: "48ec6617-f050-4cc8-9da6-16cdd9d434cb",
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

function modelReturnsRawContent(content: string) {
  const chat = vi.fn().mockResolvedValue({
    response: { ok: true },
    content,
  });
  createClient.mockReturnValue({ chat });
  return chat;
}

function injectedSupabase() {
  const tables: string[] = [];
  const writes: string[] = [];
  return { tables, writes };
}

let auditWrites: AuditRecord[] = [];

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("", { status: 404 })),
  );
  createClient.mockReset();
  auditWrites = [];
  setAuditWriteSeam(async (record) => {
    auditWrites.push(record);
    return null;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetAuditEmitterForTests();
});

describe("runProductsPhase", () => {
  it("persists refresh candidates against the live brand", async () => {
    modelReturns([rawProposal()]);
    const insert = vi.fn().mockResolvedValue({ data: null, error: null });

    await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
      candidateWriter: { insert },
    });

    expect(insert.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ brand_id: BRAND.source_brand_id }),
      ]),
    );
  });

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
    const { tables, writes } = injectedSupabase();

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.phaseResult.status).toBe("succeeded");
    // The second model row names a candidate with no image, so it does not
    // survive the production candidate gates and cannot become a proposal.
    expect(result.proposals).toHaveLength(1);
    // The proposals ride the patch, which becomes `enriched_data.products[]`.
    expect(result.patch.products).toHaveLength(1);
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
      productDescriptionZh: "南投陶土手拉坏，直徑 21 公分，適合日常盛裝主餐。",
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
      // Same-host pages are a precondition now, and they are the PATCHED site's:
      // the phase mines the site this run resolved, not the stale column.
      scrapedData: SCRAPED,
      pendingPatch: { purchase_website: SITE },
      target: { type: "submission", id: SUBMISSION_ID },
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
    const catalogTriples = Array.from({ length: 8 }, (_, index) => ({
      url: `${SITE}/products/clay-plate-${index + 1}`,
      title: `陶土餐盤 ${index + 1}`,
      imageUrl: `${SITE}/img/clay-plate-${index + 1}.jpg`,
      platform: "generic" as const,
      supplier: "catalog:official",
      sourceUrl: SITE,
      sourcePosition: index,
    }));
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
      catalogResult: {
        triples: catalogTriples,
        attempts: [],
        evidence: new Map(),
      },
    });

    expect(result.proposals).toHaveLength(5);
    expect(result.patch.products).toHaveLength(5);
    expect(new Set(result.proposals.map((proposal) => proposal.key)).size).toBe(
      5,
    );
  });

  it("reports a provider failure instead of an empty success", async () => {
    // The 2026-08-02 shape: every call 429s, the phase reports `succeeded`, and a
    // brand with no proposals is indistinguishable from a brand with none found.
    createClient.mockReturnValue({
      chat: vi
        .fn()
        .mockResolvedValue({ response: { ok: false }, content: null }),
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

  it("skips when the links phase left no page on the brand's own site", async () => {
    // The phase declares a hard dependency on `links` / `site_identity`, and the
    // only thing enforcing it was the job's phase list. A `phases: ['products']`
    // run hands over `scrapedData: null`, so the model would be asked to pick
    // product pages while being shown none — and nothing downstream can catch a
    // fabricated `${SITE}/products/invented`, because the host matches, the path
    // is non-root, and no URL is ever fetched.
    const chat = modelReturns([]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: null,
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.phaseResult.status).toBe("skipped");
    expect(result.phaseResult.detail).toContain("no product candidates");
    expect(chat).not.toHaveBeenCalled();
    // No answer, no opinion: an empty patch leaves the stored list alone.
    expect(result.patch).toEqual({});
  });

  it("skips when every scraped page belongs to someone else", async () => {
    const chat = modelReturns([]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: {
        ...SCRAPED,
        perSourceText: {
          "https://news.example/island-studio": {
            title: "報導",
            description: "第三方報導頁面，不是品牌自有網站。",
          },
        },
        imageSources: [],
      },
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.phaseResult.status).toBe("skipped");
    expect(chat).not.toHaveBeenCalled();
  });

  it("clears a stale list when the run answered with nothing", async () => {
    modelReturns([]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.phaseResult.status).toBe("succeeded");
    // `mergeSubmissionEnrichedData` replaces `enriched_data.products` only when
    // the patch CARRIES the key, so `{}` here left the previous run's proposals
    // in the drawer — including proposals mined from a site `site_identity` has
    // since revoked. A run that answered has a verdict; a skip does not.
    expect(Object.hasOwn(result.patch, "products")).toBe(true);
    expect(result.patch.products).toEqual([]);
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

  it("uses_catalog_candidates_when_scrape_is_empty", async () => {
    // With no scraped pages but a non-empty catalog pool, the phase must NOT
    // skip — the catalog candidates supply the user content.
    modelReturns([rawProposal()]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: { ...SCRAPED, perSourceText: {} },
      target: { type: "submission", id: SUBMISSION_ID },
      catalogResult: {
        triples: [
          {
            url: `${SITE}/products/clay-plate`,
            title: "陶土餐盤",
            imageUrl: `${SITE}/img/plate.jpg`,
            platform: "generic" as const,
            supplier: "catalog:official",
            sourceUrl: SITE,
            sourcePosition: 0,
          },
        ],
        attempts: [],
        evidence: new Map(),
      },
    });

    expect(result.phaseResult.status).toBe("succeeded");
    expect(result.proposals).toHaveLength(1);
    // The user content must carry the catalog product URL.
    const chat = createClient.mock.results[0]!.value.chat;
    const user = chat.mock.calls[0]![0].user as string;
    expect(user).toContain(`${SITE}/products/clay-plate`);
  });

  it("still_skips_when_merged_pool_is_empty", async () => {
    // Empty scrape + no catalog candidates => skipped with no LLM call.
    const chat = modelReturns([]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: { ...SCRAPED, perSourceText: {} },
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.phaseResult.status).toBe("skipped");
    expect(result.phaseResult.detail).toContain("no product candidates");
    expect(result.phaseResult.detail).not.toContain("no scraped pages");
    expect(chat).not.toHaveBeenCalled();
    expect(result.patch).toEqual({});
  });

  it("listing_pages_are_not_proposable", async () => {
    // An acquisition `/collections/chairs` candidate should appear in the
    // entry-points block only, never as a product candidate.
    modelReturns([rawProposal()]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: { ...SCRAPED, perSourceText: {} },
      target: { type: "submission", id: SUBMISSION_ID },
      acquisitionPageUrls: [`${SITE}/collections/chairs`],
      catalogResult: {
        triples: [
          {
            url: `${SITE}/products/clay-plate`,
            title: "陶土餐盤",
            imageUrl: `${SITE}/img/plate.jpg`,
            platform: "generic" as const,
            supplier: "catalog:official",
            sourceUrl: SITE,
            sourcePosition: 0,
          },
        ],
        attempts: [],
        evidence: new Map(),
      },
    });

    expect(result.phaseResult.status).toBe("succeeded");
    // The listing URL appears in the entry-points block of user content,
    // not in the candidate pages block.
    const chat = createClient.mock.results[0]!.value.chat;
    const user = chat.mock.calls[0]![0].user as string;
    expect(user).toContain(`${SITE}/collections/chairs`);
    // The product candidate is in the candidate pages section.
    expect(user).toContain(`${SITE}/products/clay-plate`);
  });

  it("dedupes_near_duplicate_candidates_before_prompting", async () => {
    // Two colourway URLs of one product (same normalizedUrl after variant
    // stripping) must collapse to one candidate slot in the merged pool.
    // Without dedupe, both occupy slots and both persist as separate rows.
    const chat = modelReturns([rawProposal()]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      // Empty perSourceText AND imageSources: only catalog candidates contribute
      // to the prompt, so the count is not inflated by a stray image-candidates
      // line sharing the same URL prefix.
      scrapedData: { ...SCRAPED, perSourceText: {}, imageSources: [] },
      target: { type: "submission", id: SUBMISSION_ID },
      catalogResult: {
        triples: [
          {
            url: `${SITE}/products/clay-plate?variant=blue`,
            title: "陶土餐盤 - 藍色",
            imageUrl: `${SITE}/img/plate-blue.jpg`,
            platform: "generic" as const,
            supplier: "catalog:official",
            sourceUrl: SITE,
            sourcePosition: 0,
          },
          {
            url: `${SITE}/products/clay-plate?variant=red`,
            title: "陶土餐盤 - 紅色",
            imageUrl: `${SITE}/img/plate-red.jpg`,
            platform: "generic" as const,
            supplier: "catalog:official",
            sourceUrl: SITE,
            sourcePosition: 1,
          },
        ],
        attempts: [],
        evidence: new Map(),
      },
    });

    expect(result.phaseResult.status).toBe("succeeded");
    // The user content must carry the URL only once — deduped.
    // Without dedupeNearDuplicates in the pipeline, both colourway URLs would
    // survive (different raw URLs, same normalizedUrl) and produce two lines.
    const user = chat.mock.calls[0]![0].user as string;
    const occurrences = user.split(`${SITE}/products/clay-plate`).length - 1;
    expect(occurrences).toBe(1);
  });

  it("filters_off_host_acquisition_candidates", async () => {
    // Acquisition candidates may include off-host URLs. These must never
    // reach the prompt — they consume MAX_CANDIDATE_PAGES slots and crowd
    // out valid candidates.
    const chat = modelReturns([rawProposal()]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: { ...SCRAPED, perSourceText: {} },
      target: { type: "submission", id: SUBMISSION_ID },
      acquisitionPageUrls: [
        "https://shopee.tw/product/12345",
        "https://www.pinterest.com/pin/67890",
        `${SITE}/products/clay-plate`,
      ],
      catalogResult: {
        triples: [
          {
            url: `${SITE}/products/clay-plate`,
            title: "陶土餐盤",
            imageUrl: `${SITE}/img/plate.jpg`,
            platform: "generic" as const,
            supplier: "catalog:official",
            sourceUrl: SITE,
            sourcePosition: 0,
          },
        ],
        attempts: [],
        evidence: new Map(),
      },
    });

    expect(result.phaseResult.status).toBe("succeeded");
    const user = chat.mock.calls[0]![0].user as string;
    // Off-host URLs must not appear in the user content.
    expect(user).not.toContain("shopee.tw");
    expect(user).not.toContain("pinterest.com");
    // The on-host candidate must appear.
    expect(user).toContain(`${SITE}/products/clay-plate`);
  });

  it("scraped_candidates_get_imageUrl_from_imageSources", async () => {
    // imageSources carries a mapping from pageUrl → image url. When a scraped
    // candidate's URL matches a pageUrl entry, the candidate should carry the
    // image into the merged pool so that the model and downstream persistence
    // see it — parity with stored candidates that already have imageUrl.
    const chat = modelReturns([rawProposal()]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.phaseResult.status).toBe("succeeded");
    // The user content sent to the model must contain the scraped product URL.
    const user = chat.mock.calls[0]![0].user as string;
    expect(user).toContain(`${SITE}/products/clay-plate`);
    // Exact candidate-bound image validation can only succeed when the model
    // sees the same image evidence that survived the candidate gates.
    expect(user).toContain(`${SITE}/img/plate.jpg`);
  });

  it("scraped_candidates_get_searchPosition", async () => {
    // Scraped candidates should receive a sequential searchPosition so the
    // sort-by-position logic in the merged pool preserves insertion order.
    const chat = modelReturns([rawProposal()]);

    const threeProducts = {
      ...SCRAPED,
      perSourceText: {
        [`${SITE}/products/alpha`]: { title: "Alpha" },
        [`${SITE}/products/beta`]: { title: "Beta" },
        [`${SITE}/products/gamma`]: { title: "Gamma" },
      },
    };

    await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: threeProducts,
      target: { type: "submission", id: SUBMISSION_ID },
    });

    // All three product URLs should appear in user content in some order —
    // the searchPosition assignment means they sort stably rather than
    // falling to MAX_SAFE_INTEGER.
    const user = chat.mock.calls[0]![0].user as string;
    expect(user).toContain(`${SITE}/products/alpha`);
    expect(user).toContain(`${SITE}/products/beta`);
    expect(user).toContain(`${SITE}/products/gamma`);
  });

  it("rejects another seller's candidate on a shared marketplace host", async () => {
    const ownedUrl = "https://pinkoi.com/product/owned-item";
    const otherSellerUrl = "https://pinkoi.com/product/other-seller-item";
    const chat = modelReturns([
      rawProposal({
        official_url: ownedUrl,
        image_source_url: "https://cdn01.pinkoi.com/product/owned.jpg",
      }),
    ]);

    const loadOriginTexts = vi.fn(async () => new Map<string, string>());
    const result = await runProductsPhase({
      brand: {
        ...BRAND,
        purchase_website: null,
        purchase_pinkoi: "https://pinkoi.com/store/island-studio",
      },
      phases: PHASES,
      scrapedData: {
        ...SCRAPED,
        perSourceText: {
          [ownedUrl]: { title: "Owned item" },
          [otherSellerUrl]: { title: "Other seller item" },
        },
      },
      target: { type: "submission", id: SUBMISSION_ID },
      acquisitionPageUrls: [otherSellerUrl],
      loadOriginTexts,
      catalogResult: {
        triples: [
          {
            url: ownedUrl,
            title: "Owned item",
            imageUrl: "https://cdn01.pinkoi.com/product/owned.jpg",
            platform: "pinkoi",
            supplier: "catalog:pinkoi",
            sourceUrl: "https://pinkoi.com/store/island-studio",
            sourcePosition: 0,
          },
        ],
        attempts: [],
        evidence: new Map([
          [
            ownedUrl,
            {
              title: "Owned item",
              text: "Made by Island Studio in Taiwan.",
              imageUrls: ["https://cdn01.pinkoi.com/product/owned.jpg"],
            },
          ],
        ]),
      },
    });

    expect(result.phaseResult.status).toBe("succeeded");
    const user = chat.mock.calls[0]![0].user as string;
    expect(user).toContain(ownedUrl);
    expect(user).toContain("Made by Island Studio in Taiwan.");
    expect(user).not.toContain(otherSellerUrl);
    expect(loadOriginTexts).toHaveBeenCalledWith([]);
  });

  it("existing_scraped_path_still_works", async () => {
    // When only perSourceText is populated (no catalog or acquisition
    // candidates), the phase works exactly as before — no regression.
    modelReturns([rawProposal()]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.phaseResult.status).toBe("succeeded");
    expect(result.proposals).toHaveLength(1);
    const chat = createClient.mock.results[0]!.value.chat;
    const user = chat.mock.calls[0]![0].user as string;
    expect(user).toContain(`${SITE}/products/clay-plate`);
  });

  it("products_phase_accepts_catalog_result_input", async () => {
    // When catalogResult is passed in, its triples become enumerated candidates
    // in the merged pool — the products phase no longer runs discovery itself.
    const chat = modelReturns([
      rawProposal({
        official_url: `${SITE}/products/clay-plate`,
        image_source_url: `${SITE}/products/clay-plate`,
      }),
    ]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
      catalogResult: {
        triples: [
          {
            url: `${SITE}/products/clay-plate`,
            title: "catalog plate",
            imageUrl: `${SITE}/img/plate.jpg`,
            platform: "generic",
            supplier: "catalog:generic",
            sourceUrl: SITE,
            sourcePosition: 0,
          },
        ],
        attempts: [],
        evidence: new Map([
          [
            `${SITE}/products/clay-plate`,
            {
              title: "catalog plate",
              text: "A ceramic plate from catalog.",
              imageUrls: [`${SITE}/img/plate.jpg`],
            },
          ],
        ]),
      },
    });

    expect(result.phaseResult.status).toBe("succeeded");
    const user = chat.mock.calls[0]![0].user as string;
    // The catalog evidence text should appear in the user content
    expect(user).toContain("A ceramic plate from catalog.");
  });

  it("products_phase_accepts_acquisition_page_urls", async () => {
    // Acquisition page URLs from the images phase are built into candidates
    // and included in the merged pool.
    const chat = modelReturns([rawProposal()]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: { ...SCRAPED, perSourceText: {} },
      target: { type: "submission", id: SUBMISSION_ID },
      acquisitionPageUrls: [`${SITE}/products/clay-plate`],
    });

    expect(result.phaseResult.status).toBe("succeeded");
    const user = chat.mock.calls[0]![0].user as string;
    expect(user).toContain(`${SITE}/products/clay-plate`);
  });
});

describe("validateProductProposals", () => {
  it("accepts only exact candidate URLs and candidate-bound CDN images", () => {
    const candidate: ProductCandidate = {
      url: `${SITE}/products/clay-plate`,
      normalizedUrl: `${SITE}/products/clay-plate`,
      title: "陶土餐盤",
      imageUrl: "https://cdn.example/clay-plate.jpg",
      supplier: "catalog:generic",
      urlClass: "product-detail",
    };
    const { proposals, dropped } = validateProductProposals(
      {
        products: [
          rawProposal({ image_source_url: candidate.imageUrl }),
          rawProposal({
            name_zh: "猜測商品",
            official_url: `${SITE}/products/guessed`,
          }),
          rawProposal({
            name_zh: "錯圖",
            image_source_url: "https://cdn.example/other.jpg",
          }),
        ],
      },
      { siteUrl: SITE, candidates: [candidate] },
    );

    expect(dropped).toBe(1);
    expect(proposals[0]?.imageSourceUrl).toBe(candidate.imageUrl);
    expect(proposals[1]?.imageSourceUrl).toBeUndefined();
  });

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
      {
        products: [
          rawProposal({ subcategories: ["馬克杯", "餐具", "bedding"] }),
        ],
      },
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

  it("drops a proposal the review boundary could never save", () => {
    // `adminReviewSchema` parses the whole stored list on EVERY save from every
    // section, so one over-long value locks the reviewer out of saving anything
    // at all, behind a generic "Invalid submission review" naming no field.
    const { proposals, dropped, dropReasons } = validateProductProposals(
      {
        products: [
          rawProposal({ name_zh: "陶".repeat(201) }),
          rawProposal({ name_en: "Clay Plate ".repeat(30) }),
          rawProposal({
            official_url: `${SITE}/products/${"a".repeat(2100)}`,
          }),
          rawProposal(),
        ],
      },
      { siteUrl: SITE },
    );

    expect(proposals).toHaveLength(1);
    expect(dropped).toBe(3);
    expect(dropReasons.outside_payload_bounds).toBe(3);
    // A dropped candidate hands its key back, so the survivor is not suffixed
    // for collisions that never made it into the list.
    expect(proposals[0]!.key).not.toMatch(/-\d+$/u);
  });

  it("resolves a material slug whatever case the model returned", () => {
    const { proposals } = validateProductProposals(
      { products: [rawProposal({ material: ["Ceramic", " WOOD ", "陶瓷"] })] },
      { siteUrl: SITE },
    );

    // `normalizeCuratedMaterials` on the write path lowercases before the
    // lookup, so `createCuratedProduct` accepts these; resolving them verbatim
    // here stored `material: []` and recorded no drop at all. A Chinese label
    // still resolves on neither path.
    expect(proposals[0]!.material).toEqual(["ceramic", "wood"]);
  });

  it("resolves a subcategory slug whatever case the model returned", () => {
    const { proposals } = validateProductProposals(
      { products: [rawProposal({ subcategories: ["Home-Fragrance"] })] },
      { siteUrl: SITE },
    );

    // `matchSubcategory` normalises case itself; `subcategoryBySlug` does not,
    // and a hyphenated slug matches no label, so this resolved through neither.
    expect(proposals[0]!.subcategories).toEqual(["home-fragrance"]);
  });

  it("clears an image_source_url the brand does not own, and keeps the product", () => {
    const { proposals, dropped } = validateProductProposals(
      {
        products: [
          rawProposal({
            image_source_url: "https://www.pinterest.com/pin/12345",
          }),
          rawProposal({
            name_zh: "柴燒品茗杯",
            official_url: `${SITE}/products/tea-cup`,
            // The brand's own homepage is a legitimate image page, so the gate
            // is host equality, not the non-root path `official_url` requires.
            image_source_url: `${SITE}/`,
            sources: [
              { url: `${SITE}/products/tea-cup`, source_type: "official" },
            ],
          }),
        ],
      },
      { siteUrl: SITE },
    );

    // The field records where an image came from so usage rights stay
    // re-checkable; a pin on a host the brand does not own records a permission
    // the brand cannot give. Clearing it keeps a good product proposal usable.
    expect(dropped).toBe(0);
    expect(proposals[0]!.imageSourceUrl).toBeUndefined();
    expect(proposals[1]!.imageSourceUrl).toBe(`${SITE}/`);
  });

  it("keeps proposal keys unique when the caller raises the cap", () => {
    const { proposals } = validateProductProposals(
      {
        products: Array.from({ length: 8 }, () =>
          rawProposal({ name_zh: "陶土餐盤" }),
        ),
      },
      { siteUrl: SITE, max: 8 },
    );

    // The suffix loop is bounded by the CALLER's cap. Pinned to the module
    // constant it ran out at the sixth key and fell through to a fallback that
    // never checked `taken` — a duplicate key from the one function whose job is
    // to prevent duplicates.
    expect(proposals).toHaveLength(8);
    expect(new Set(proposals.map((proposal) => proposal.key)).size).toBe(8);
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

  it("rawCount equals the number of items in the model response", () => {
    const items = [rawProposal(), rawProposal({ name_zh: "柴燒品茗杯" })];
    const { rawCount } = validateProductProposals(
      { products: items },
      { siteUrl: SITE },
    );

    expect(rawCount).toBe(2);
  });

  it("rawCount === proposals.length + dropped for every fixture", () => {
    const fixtures = [
      // All valid
      {
        products: [
          rawProposal(),
          rawProposal({
            name_zh: "柴燒品茗杯",
            official_url: `${SITE}/products/tea-cup`,
            sources: [
              { url: `${SITE}/products/tea-cup`, source_type: "official" },
            ],
          }),
        ],
      },
      // Some invalid (no name, off-site URL)
      {
        products: [
          rawProposal({ name_zh: "" }),
          rawProposal({ official_url: "https://other.example/x" }),
          rawProposal(),
        ],
      },
      // Empty array
      { products: [] },
      // Not an array
      { products: undefined },
    ];

    for (const fixture of fixtures) {
      const { rawCount, proposals, dropped } = validateProductProposals(
        fixture,
        { siteUrl: SITE },
      );
      expect(rawCount).toBe(proposals.length + dropped);
    }
  });
});

describe("rawCount and productsParseError in runProductsPhase", () => {
  it("parseJson returning null sets productsParseError true and productsFromModel 0", async () => {
    modelReturnsRawContent("this is not valid JSON {{{{");

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.phaseResult.status).toBe("succeeded");
    expect(result.proposals).toHaveLength(0);

    const terminal = auditWrites.findLast(
      (r) => r.operation === "runProductsPhase",
    );
    expect(terminal).toBeDefined();
    const summary = terminal!.summary as Record<string, unknown>;
    expect(summary.productsFromModel).toBe(0);
    expect(summary.productsParseError).toBe(true);
  });

  it("empty products array sets productsFromModel 0 with no parse error", async () => {
    modelReturns([]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.phaseResult.status).toBe("succeeded");
    expect(result.proposals).toHaveLength(0);

    const terminal = auditWrites.findLast(
      (r) => r.operation === "runProductsPhase",
    );
    expect(terminal).toBeDefined();
    const summary = terminal!.summary as Record<string, unknown>;
    expect(summary.productsFromModel).toBe(0);
    expect(summary.productsParseError).toBeUndefined();
  });

  it("empty-pool exit carries catalogZeroReason", async () => {
    const chat = modelReturns([]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: { ...SCRAPED, perSourceText: {} },
      target: { type: "submission", id: SUBMISSION_ID },
      catalogResult: {
        triples: [],
        attempts: [],
        evidence: new Map(),
        zeroReason: "no_catalog" as const,
      },
    });

    expect(result.phaseResult.status).toBe("skipped");
    expect(result.phaseResult.catalogZeroReason).toBe("no_catalog");
    expect(result.phaseResult.productsProposed).toBe(0);
    expect(chat).not.toHaveBeenCalled();
  });

  it("succeeded exit carries productsProposed count", async () => {
    modelReturns([rawProposal()]);

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
    });

    expect(result.phaseResult.status).toBe("succeeded");
    expect(result.phaseResult.productsProposed).toBe(1);
  });

  it("LLM failure exit carries catalogZeroReason with productsProposed 0", async () => {
    createClient.mockReturnValue({
      chat: vi
        .fn()
        .mockResolvedValue({ response: { ok: false }, content: null }),
    });

    const result = await runProductsPhase({
      brand: BRAND,
      phases: PHASES,
      scrapedData: SCRAPED,
      target: { type: "submission", id: SUBMISSION_ID },
      catalogResult: {
        triples: [
          {
            url: `${SITE}/products/clay-plate`,
            title: "陶土餐盤",
            imageUrl: `${SITE}/img/plate.jpg`,
            platform: "generic" as const,
            supplier: "catalog:official",
            sourceUrl: SITE,
            sourcePosition: 0,
          },
        ],
        attempts: [],
        evidence: new Map(),
        zeroReason: "no_catalog" as const,
      },
    });

    expect(result.phaseResult.status).toBe("failed");
    expect(result.phaseResult.providerFailure).toBe(true);
    expect(result.phaseResult.catalogZeroReason).toBe("no_catalog");
    expect(result.phaseResult.productsProposed).toBe(0);
  });
});
