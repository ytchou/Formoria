import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import snapshot from "@/lib/prompts/langfuse-snapshot.json";
import { TAIWAN_USAGE_RULES } from "@/lib/prompts/shared";
import {
  ENRICH_PHASES,
  ENRICH_STAGE_GROUPS,
} from "@/lib/constants/enrich-phases";
import {
  CUSTOM_QUESTION_CEILING,
  eligibleFaqPresets,
} from "@/lib/brands/faq-presets";
import type { FaqBrandContext } from "@/lib/brands/faq-presets";
import type { Brand } from "@/lib/types";
import type { BrandFaqEntryRow } from "../../brand-faq";
import {
  type ExistingStockistRow,
  upsertEnrichedStockists,
  type StockistsSupabase,
} from "../../stockists";
import type { EnrichBrand, EnrichPhase } from "../types";
import { normalizeStockistName } from "@/lib/brands/stockist-display";
import {
  contextFacts,
  countWhereToBuy,
  faqBrandName,
  faqCoverageIsComplete,
  localizedCityLabel,
  resolveFaqAttempts,
  resolvePendingStockists,
  runFaqPhase,
  validateFaqEntries,
} from "../faq";

/**
 * The `fetchLangfusePrompt` mock is legitimate because `@/lib/langfuse/prompt`
 * is an adapter (external service client), not an internal service — the
 * `check:test-boundaries` gate forbids mocking `@/lib/services/*` and
 * `@/lib/supabase/*`, not the Langfuse adapter.
 */
const fetchLangfusePrompt = vi.hoisted(() =>
  vi.fn((_name: string) => Promise.resolve("mock-prompt")),
);
const fetchLangfusePromptWithMeta = vi.hoisted(() =>
  vi.fn((_name: string) => Promise.resolve({ text: "mock-prompt", prompt: { name: _name, version: 1, source: "langfuse" } })),
);
vi.mock("@/lib/langfuse/prompt", () => ({ fetchLangfusePrompt, fetchLangfusePromptWithMeta }));

/**
 * Service dependencies mocked via relative path to reach the
 * `fetchLangfusePrompt` call inside `runFaqPhase`. Same technique as
 * `products.test.ts` uses for `../../llm-audit`.
 */
const createClient = vi.hoisted(() => vi.fn());
vi.mock("../../llm-audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../llm-audit")>()),
  createProfiledOpenAIClient: createClient,
}));
const getBrandById = vi.hoisted(() => vi.fn());
vi.mock("../../brands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brands")>()),
  getBrandById,
}));
const getCategoryPeerStats = vi.hoisted(() => vi.fn());
vi.mock("../../brand-peer-stats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brand-peer-stats")>()),
  getCategoryPeerStats,
}));
const loadPersistedScrapeText = vi.hoisted(() => vi.fn());
vi.mock("../descriptions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../descriptions")>()),
  loadPersistedScrapeText,
}));
const getBrandFaqEntries = vi.hoisted(() => vi.fn());
const upsertBrandFaqEntries = vi.hoisted(() => vi.fn());
vi.mock("../../brand-faq", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brand-faq")>()),
  getBrandFaqEntries,
  upsertBrandFaqEntries,
}));
const getStockistsForBrand = vi.hoisted(() => vi.fn());
const getStockistMatchPool = vi.hoisted(() =>
  vi.fn(async (_brandId: string): Promise<ExistingStockistRow[]> => []),
);
vi.mock("../../stockists", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../stockists")>()),
  getStockistsForBrand,
  getStockistMatchPool,
}));

/**
 * Driven through the phase's exported pure pieces rather than through
 * `runFaqPhase` itself. The phase reads Supabase, and this project forbids
 * mocking it — `pnpm lint` runs `check:test-boundaries`, which fails on a test
 * that mocks `@/lib/supabase/*` or `@/lib/services/*`. `validateFaqEntries`
 * holds the entire accept/drop decision and `resolveFaqAttempts` holds the
 * whole retry contract, so nothing is lost by testing them directly. This
 * follows `reputation.test.ts`, which made the same call for the same reason.
 */

const BRAND: Brand = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "小島工坊",
  slug: "island-studio",
  description: "以天然材料製作日用品。",
  descriptionEn: "Everyday goods made with natural materials.",
  blurb: null,
  blurbEn: null,
  heroImageUrl: null,
  status: "approved",
  categorySlug: "home",
  city: "臺南",
  categoryLabel: "居家生活",
  isDemo: false,
  foundingYear: null,
  reputationSummary: null,
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  otherUrls: [],
  productPhotos: [],
  imageAlts: [],
  contactEmail: null,
  subcategories: [],
  subcategoriesEn: [],
  siteContent: null,
  submittedAt: "2026-01-01T00:00:00.000Z",
  approvedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  onboardingDismissedAt: null,
  purchaseWebsite: null,
  purchasePinkoi: null,
  purchaseShopee: null,
  purchaseMyship: null,
} as Brand;

const PEER_STATS: NonNullable<FaqBrandContext["peerStats"]> = {
  peerCount: 2,
};

/**
 * A purchase channel makes `where-to-buy` authorable — the fixtures' one
 * non-custom preset since `category-position` stopped being authored
 * (DEV-1954). Two notGeneric signals (city, website), so that check stays
 * below its threshold and out of these tests.
 */
const WITH_CHANNEL = { purchaseWebsite: "https://island.example.com" };

function context(
  overrides: Partial<Brand> & { stockistCount?: number } = {},
  peerStats: FaqBrandContext["peerStats"] = null,
): FaqBrandContext {
  const brand = { ...BRAND, ...overrides } as Brand & { stockistCount?: number };
  return { brand: brand as FaqBrandContext["brand"], cityLabel: localizedCityLabel(brand.city), peerStats };
}

/** The model-authorable eligible set, exactly as the phase computes it. */
function authorable(ctx: FaqBrandContext) {
  return eligibleFaqPresets(ctx).filter(
    (preset) =>
      preset.promptFragment !== null && (preset.authorable?.(ctx) ?? true),
  );
}

/**
 * Built to land inside the zh 200–320 字 band on purpose. A hand-written
 * literal drifts out of band the moment someone edits a word, and then the
 * test starts asserting the length check instead of what it names.
 */
function zhAnswer(seed: string): string {
  return seed.padEnd(240, "詳");
}

/**
 * Same idea for the en 120–180 word band, with two constraints the padding has
 * to respect or it starts failing checks the test never meant to exercise:
 * every filler token is distinct (repeating one word trips `noKeywordStuffing`,
 * whose ceiling is 8% of the answer), and the filler is seeded from the seed
 * text so two different answers share no filler (a shared filler block would
 * make every pair of answers read as near-duplicates to `notDuplicateOf`).
 */
function enAnswer(seed: string): string {
  const words = seed.split(/\s+/u);
  const tag = Array.from(seed).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  let index = 0;
  while (words.length < 140) {
    words.push(`detail${tag}n${index}`);
    index += 1;
  }
  return words.join(" ");
}

/**
 * Four genuinely different zh answers. They have to be different in vocabulary,
 * not just in wording: `notDuplicateOf` compares token sets, so four rephrasings
 * of one sentence would reject each other and the test would be measuring the
 * duplicate check instead of the thing it names.
 */
const CUSTOM_SEEDS = [
  "這個品牌的自訂回答談製作流程，從備料、打樣到成品檢查都由同一組師傅負責。",
  "關於保養方式，日常擦拭與定期上油可以延長使用年限，避免陽光直射與潮濕環境。",
  "在包裝上採用可回收紙材，並以最少的印刷面積降低油墨用量，寄送時另附使用說明。",
  "常見的客製需求包含尺寸微調與刻字，需要提前預約，工期會依季節排程有所不同。",
];

function modelEntry(
  presetId: string,
  overrides: { answerZh?: string; answerEn?: string } = {},
) {
  return {
    preset_id: presetId,
    question_zh: "這個品牌的特色是什麼？",
    answer_zh:
      overrides.answerZh ??
      zhAnswer(
        "這個品牌以天然材料製作日用品，選料、裁切與手工縫製都在自有工坊完成。",
      ),
    question_en: "What makes this brand distinctive?",
    answer_en:
      overrides.answerEn ??
      enAnswer("This brand makes everyday goods from natural materials."),
  };
}

describe("faq phase wiring", () => {
  it("faq is in exactly one stage group", () => {
    const groups = Object.values(ENRICH_STAGE_GROUPS).filter((phases) =>
      (phases as readonly string[]).includes("faq"),
    );
    expect(groups).toHaveLength(1);
  });

  it("faq runs after descriptions", () => {
    expect(ENRICH_PHASES.indexOf("faq")).toBeGreaterThan(
      ENRICH_PHASES.indexOf("descriptions"),
    );
    // `products` runs after faq, so the last-phase claim now lives in
    // src/lib/constants/__tests__/enrich-phases.test.ts, which owns that ordering.
    expect(ENRICH_PHASES.indexOf("products")).toBeGreaterThan(
      ENRICH_PHASES.indexOf("faq"),
    );
  });
});

describe("validateFaqEntries", () => {
  it("drops an answer for an ineligible preset", () => {
    // No subcategories on file, so `main-products` never entered the prompt and
    // must not be storable even when the model answers it anyway.
    const ctx = context();
    const presets = authorable(ctx);
    expect(presets.map((preset) => preset.id)).not.toContain("main-products");

    const outcome = validateFaqEntries(
      { entries: [modelEntry("main-products")] },
      presets,
      ctx,
    );

    expect(outcome.entries).toEqual([]);
    expect(outcome.dropped).toBe(1);
    // Reported to the model, but as an *unrepairable* rejection: no repair
    // instruction can make a preset the model was never allowed to author
    // become authorable, so this must never be what spends the retry.
    expect(outcome.unrepairable[0]?.presetId).toBe("main-products");
    expect(outcome.failures).toEqual([]);
  });

  it("drops an answer containing an NT$ figure", () => {
    // `where-to-buy` is eligible here, so the drop can only come from the
    // commerce check — not from eligibility.
    const ctx = context(WITH_CHANNEL);
    const presets = authorable(ctx);
    expect(presets.map((preset) => preset.id)).toContain("where-to-buy");

    const clean = validateFaqEntries(
      { entries: [modelEntry("where-to-buy")] },
      presets,
      ctx,
    );
    expect(clean.entries).toHaveLength(1);

    const outcome = validateFaqEntries(
      {
        entries: [
          modelEntry("where-to-buy", {
            answerZh: zhAnswer(
              "這個品牌的入門品項售價為 NT$ 800，屬於同類品牌的中段位置。",
            ),
          }),
        ],
      },
      presets,
      ctx,
    );

    expect(
      outcome.entries.some((entry) => entry.answerZh?.includes("NT$")),
    ).toBe(false);
    expect(
      outcome.failures.some(
        (failure) =>
          failure.locale === "zh" && /commerce/i.test(failure.reason),
      ),
    ).toBe(true);
  });

  it("returns zero customs rather than weak ones", () => {
    // A sparse brand's custom answers come back too thin to clear the length
    // band. Padding is never the fallback — the custom set is simply empty.
    const ctx = context();
    const presets = authorable(ctx);
    expect(presets.map((preset) => preset.id)).toContain("custom");

    const outcome = validateFaqEntries(
      {
        entries: [
          modelEntry("custom", { answerZh: "資料不足。", answerEn: "Thin." }),
          modelEntry("custom", {
            answerZh: "沒有更多資訊。",
            answerEn: "None.",
          }),
        ],
      },
      presets,
      ctx,
    );

    expect(
      outcome.entries.filter((entry) => entry.presetId === "custom"),
    ).toEqual([]);
    expect(outcome.dropped).toBe(2);
  });

  it("keeps one entry per non-custom preset", () => {
    // Two answers for the same preset would both take `position = 0`, and the
    // single upsert would then hit `brand_id,preset_id,position` twice —
    // Postgres 21000, which fails the whole phase.
    const ctx = context(WITH_CHANNEL);
    const presets = authorable(ctx);

    const outcome = validateFaqEntries(
      {
        entries: [
          modelEntry("where-to-buy"),
          modelEntry("where-to-buy", {
            answerZh: zhAnswer(CUSTOM_SEEDS[1]),
            answerEn: enAnswer(
              "A second take on the same comparative question.",
            ),
          }),
        ],
      },
      presets,
      ctx,
    );

    const channelEntries = outcome.entries.filter(
      (entry) => entry.presetId === "where-to-buy",
    );
    expect(channelEntries).toHaveLength(1);
    expect(channelEntries[0]?.position).toBe(0);
    expect(outcome.dropped).toBe(1);
  });

  it("drops an over-ceiling custom before validating it", () => {
    // The over-ceiling entry carries a currency figure. If the ceiling were
    // still checked after validation, that figure would show up as a commerce
    // failure — and a failure is what spends the second LLM attempt.
    const ctx = context();
    const presets = authorable(ctx);
    // The fixture has to be able to fill the ceiling, or the last entry would
    // be validated for a reason this test is not about.
    expect(CUSTOM_SEEDS.length).toBeGreaterThanOrEqual(CUSTOM_QUESTION_CEILING);

    const outcome = validateFaqEntries(
      {
        entries: [
          ...CUSTOM_SEEDS.slice(0, CUSTOM_QUESTION_CEILING).map((seed, index) =>
            modelEntry("custom", {
              answerZh: zhAnswer(seed),
              answerEn: enAnswer(
                `Custom answer number ${index} covering a separate topic.`,
              ),
            }),
          ),
          modelEntry("custom", {
            answerZh: zhAnswer("這個品項的售價為 NT$ 900，屬於中段。"),
            answerEn: enAnswer("An extra answer beyond the ceiling."),
          }),
        ],
      },
      presets,
      ctx,
    );

    expect(
      outcome.entries.filter((entry) => entry.presetId === "custom"),
    ).toHaveLength(CUSTOM_QUESTION_CEILING);
    expect(
      outcome.failures.some((failure) => /commerce/i.test(failure.reason)),
    ).toBe(false);
    expect(outcome.dropped).toBe(1);
  });
});

describe("localizedCityLabel", () => {
  it("resolves the slug to the label the brand page renders", () => {
    // The render path calls `tCities(brand.city)`; a prompt built on the raw
    // slug would describe the brand differently from its own page.
    expect(localizedCityLabel("taipei")).toBe("臺北市");
    expect(localizedCityLabel(null)).toBeNull();
    // An unmapped value passes through rather than becoming null: losing the
    // city entirely is worse than an unlocalized one.
    expect(localizedCityLabel("atlantis")).toBe("atlantis");
  });
});

describe("faqCoverageIsComplete", () => {
  function row(
    presetId: string,
    position = 0,
    overrides: Partial<BrandFaqEntryRow> = {},
  ): BrandFaqEntryRow {
    return {
      presetId,
      position,
      questionZh: "問題",
      answerZh: "回答",
      questionEn: "Question",
      answerEn: "Answer",
      source: "model",
      ...overrides,
    };
  }

  // A purchase channel makes the set wider than `custom` alone —
  // a single-preset set would not show the per-preset accounting at all.
  const presets = authorable(context(WITH_CHANNEL, PEER_STATS));

  function completeRows(): BrandFaqEntryRow[] {
    return presets.flatMap((preset) =>
      preset.id === "custom"
        ? Array.from({ length: CUSTOM_QUESTION_CEILING }, (_, index) =>
            row("custom", index),
          )
        : [row(preset.id)],
    );
  }

  it("covers a set wider than custom alone", () => {
    expect(
      presets.filter((preset) => preset.id !== "custom").length,
    ).toBeGreaterThan(0);
  });

  it("is complete when every authorable preset has a two-locale entry", () => {
    expect(faqCoverageIsComplete(presets, completeRows())).toBe(true);
  });

  // DEV-1954: peer stats are present, yet `category-position` is no longer
  // authored, so its absence must not trigger a re-authoring LLM call.
  it("is complete when only a category-position row is missing", () => {
    expect(presets.map((preset) => preset.id)).not.toContain(
      "category-position",
    );
    const rows = completeRows();
    expect(rows.some((entry) => entry.presetId === "category-position")).toBe(
      false,
    );

    expect(faqCoverageIsComplete(presets, rows)).toBe(true);
  });

  it("is incomplete when a stored entry renders in only one locale", () => {
    // The gate exists to skip a call that would write nothing; a zh-only row
    // still has an English gap the phase can fill, so it must not skip.
    const rows = presets.flatMap((preset) =>
      preset.id === "custom"
        ? Array.from({ length: CUSTOM_QUESTION_CEILING }, (_, index) =>
            row("custom", index),
          )
        : [row(preset.id, 0, { questionEn: null, answerEn: null })],
    );

    expect(faqCoverageIsComplete(presets, rows)).toBe(false);
  });

  it("is incomplete when nothing is stored", () => {
    expect(faqCoverageIsComplete(presets, [])).toBe(false);
  });
});

describe("resolveFaqAttempts", () => {
  it("retries once with a repair instruction on a repairable failure", async () => {
    const ctx = context(WITH_CHANNEL);
    const presets = authorable(ctx);
    const send = vi
      .fn<
        (
          retryInstruction: string,
          attempt: number,
        ) => Promise<{ ok: boolean; content: string | null }>
      >()
      // Attempt 1 puts a currency figure in the factual channel answer — a real
      // repairable rejection, the kind the second call exists for.
      .mockResolvedValueOnce({
        ok: true,
        content: JSON.stringify({
          entries: [
            modelEntry("where-to-buy", {
              answerZh: zhAnswer(
                "這個品牌的入門品項售價為 NT$ 800，屬於同類品牌的中段位置。",
              ),
            }),
          ],
        }),
      })
      // Attempt 2 returns the repaired entry and clears validation.
      .mockResolvedValueOnce({
        ok: true,
        content: JSON.stringify({ entries: [modelEntry("where-to-buy")] }),
      });

    const outcome = await resolveFaqAttempts(presets, ctx, send);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBe("");
    expect(send.mock.calls[1]?.[0]).toContain("修復上一版 FAQ");
    expect(send.mock.calls[1]?.[0]).toContain("where-to-buy");
    expect(outcome.entries).toHaveLength(1);
    expect(outcome.calls.attempted).toBe(2);
  });

  it("does not spend the retry on a preset that was never authorable", async () => {
    // `main-products` never entered the prompt, so "fix this" is an instruction
    // the model cannot act on — the second call would buy nothing.
    const ctx = context();
    const send = vi.fn().mockResolvedValue({
      ok: true,
      content: JSON.stringify({ entries: [modelEntry("main-products")] }),
    });

    const outcome = await resolveFaqAttempts(authorable(ctx), ctx, send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.entries).toEqual([]);
    expect(outcome.unrepairable).toHaveLength(1);
  });

  it("keeps attempt 1's accepted entries when attempt 2 returns only a repair", async () => {
    const ctx = context(WITH_CHANNEL);
    const presets = authorable(ctx);
    const send = vi
      .fn<
        (
          retryInstruction: string,
          attempt: number,
        ) => Promise<{ ok: boolean; content: string | null }>
      >()
      .mockResolvedValueOnce({
        ok: true,
        content: JSON.stringify({
          entries: [
            modelEntry("custom"),
            modelEntry("where-to-buy", {
              answerZh: zhAnswer(
                "這個品牌的入門品項售價為 NT$ 800，屬於同類品牌的中段位置。",
              ),
            }),
          ],
        }),
      })
      // The common model response to "fix these": the repaired entry alone.
      .mockResolvedValueOnce({
        ok: true,
        content: JSON.stringify({
          entries: [
            modelEntry("where-to-buy", {
              answerZh: zhAnswer(
                "這個品牌主要透過自有官方網站介紹作品，網站上整理了完整的品項說明與聯絡方式。",
              ),
              answerEn: enAnswer(
                "The brand presents its work through its own official website.",
              ),
            }),
          ],
        }),
      });

    const outcome = await resolveFaqAttempts(presets, ctx, send);

    expect(send).toHaveBeenCalledTimes(2);
    const presetIds = outcome.entries.map((entry) => entry.presetId).sort();
    expect(presetIds).toEqual(["custom", "where-to-buy"]);
  });

  it("stops at one attempt when the first one validates", async () => {
    const ctx = context();
    const send = vi.fn().mockResolvedValue({
      ok: true,
      content: JSON.stringify({ entries: [modelEntry("custom")] }),
    });

    await resolveFaqAttempts(authorable(ctx), ctx, send);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not burn the retry on a provider failure", async () => {
    const ctx = context();
    const send = vi.fn().mockResolvedValue({ ok: false, content: null });

    const outcome = await resolveFaqAttempts(authorable(ctx), ctx, send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.calls.providerFailed).toBe(1);
  });
});

describe("faqBrandName", () => {
  // DEV-1954: the system prompt pins this name verbatim, so it has to be the
  // name the brand publishes under — not the pre-`names`-phase row value.
  const submission: EnrichBrand = { id: "sub-1", slug: "s", name: "Golday Jewelry" };

  it("uses this run's accepted name for a new submission", () => {
    expect(
      faqBrandName(submission, { name: "日常金工 golday.jewelry" }),
    ).toBe("日常金工 golday.jewelry");
  });

  it("keeps the stored name for a refresh, whose rename is only a proposal", () => {
    expect(
      faqBrandName(
        { ...submission, source_brand_id: BRAND.id },
        { name: "日常金工 golday.jewelry" },
      ),
    ).toBe("Golday Jewelry");
  });

  it("falls back to the stored name when the run renamed nothing", () => {
    expect(faqBrandName(submission, undefined)).toBe("Golday Jewelry");
    expect(faqBrandName(submission, {})).toBe("Golday Jewelry");
  });
});

describe("contextFacts", () => {
  /**
   * The facts block is appended to a zh-TW user prompt. `brands.subcategories`
   * stores English slugs since DEV-1510, so without a lookup the model receives
   * Latin tokens in an otherwise Chinese brief — input the phase never meant to
   * send, and a silent quality regression rather than a failure.
   */
  it("enrichment_prompt_receives_zh_labels", () => {
    const facts = contextFacts(
      context({
        subcategories: ["backpacks", "tote-bags"],
        subcategoriesEn: ["Backpacks", "Tote Bags"],
      }),
    );

    expect(facts).toContain("產品標籤=後背包、托特包");
    expect(facts).not.toContain("backpacks");
    expect(facts).not.toContain("tote-bags");
  });

  it("keeps a tag the vocabulary has never known", () => {
    const facts = contextFacts(context({ subcategories: ["手工燈籠"] }));

    expect(facts).toContain("產品標籤=手工燈籠");
  });

  it("says 無 when the brand carries no tags", () => {
    expect(contextFacts(context())).toContain("產品標籤=無");
  });

  it("includes stockist count from context", () => {
    const facts = contextFacts(context({ stockistCount: 5 }));
    expect(facts).toContain("通路據點=5處");
  });

  it("says 無 when no stockists", () => {
    const facts = contextFacts(context());
    expect(facts).toContain("通路據點=無");
  });
});

describe("descriptions snapshot prompt", () => {
  function compiledDescriptionsPrompt(): string {
    const entry = snapshot.prompts["descriptions"];
    const raw = entry.text.join("\n");
    return raw.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      if (key === "taiwan_usage_rules") return TAIWAN_USAGE_RULES;
      return `{{${key}}}`;
    });
  }

  it("descriptions_prompt_retains_channel_and_pricing_prohibitions", () => {
    const DESCRIPTIONS = compiledDescriptionsPrompt();
    expect(DESCRIPTIONS).toContain("Purchase channels and distribution");
    expect(DESCRIPTIONS).toContain("pricing information is never written in these four fields");
    expect(DESCRIPTIONS.toLowerCase()).not.toContain("faq");
  });
});

describe("runFaqPhase langfuse variables", () => {
  it("faq_variables_passed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    getCategoryPeerStats.mockResolvedValue(null);
    loadPersistedScrapeText.mockResolvedValue({
      snippets: [],
      siteContent: null,
    });
    getBrandFaqEntries.mockResolvedValue([]);
    getStockistsForBrand.mockResolvedValue({ confirmed: [], possible: [] });
    createClient.mockReturnValue({
      chat: vi.fn().mockResolvedValue({
        response: { ok: true },
        content: JSON.stringify({ entries: [] }),
      }),
    });

    await runFaqPhase({
      brand: {
        ...(BRAND as unknown as EnrichBrand),
        source_brand_id: BRAND.id,
      },
      phases: ["faq"] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: [],
      target: { type: "submission", id: "sub-1" },
      pendingPatch: undefined,
    });

    expect(fetchLangfusePromptWithMeta).toHaveBeenCalledWith(
      "faq-preamble",
      expect.objectContaining({ taiwan_usage_rules: TAIWAN_USAGE_RULES }),
    );

    vi.unstubAllEnvs();
  });
});

// ---------------------------------------------------------------------------
// runFaqPhase submission-only contract
// ---------------------------------------------------------------------------

const ENRICH_BRAND: EnrichBrand = {
  id: "sub-1",
  slug: "island-studio",
  name: "小島工坊",
  category: "home",
  city: "臺南",
  source_brand_id: BRAND.id,
  description: "以天然材料製作日用品。",
  description_en: "Everyday goods made with natural materials.",
  subcategories: [],
  subcategories_en: [],
};

describe("runFaqPhase submission-only contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Review BS1: a purchase_website this run revoked must not stay owned.
  it("reads persisted scrape text without a host this run's pendingPatch revoked", async () => {
    getCategoryPeerStats.mockResolvedValue(null);
    loadPersistedScrapeText.mockResolvedValue({
      snippets: [],
      siteContent: null,
    });
    getBrandFaqEntries.mockResolvedValue([]);
    getStockistsForBrand.mockResolvedValue({ confirmed: [], possible: [] });
    createClient.mockReturnValue({
      chat: vi.fn().mockResolvedValue({
        response: { ok: true },
        content: JSON.stringify({ entries: [] }),
      }),
    });
    const target = { type: "submission" as const, id: "sub-1" };

    await runFaqPhase({
      brand: { ...ENRICH_BRAND, purchase_website: "https://brand.com" },
      phases: ["faq"] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: [],
      target,
      pendingPatch: { purchase_website: null },
    });

    expect(loadPersistedScrapeText).toHaveBeenCalledWith(target, new Set());
  });

  it("refuses_non_submission_targets", async () => {
    const output = await runFaqPhase({
      brand: ENRICH_BRAND,
      phases: ["faq"] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: [],
      target: { type: "brand", id: BRAND.id },
      pendingPatch: undefined,
    });

    expect(output.phaseResult.status).toBe("skipped");
    expect(output.phaseResult.detail).toContain("submission");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns_faq_patch_without_writing", async () => {
    getCategoryPeerStats.mockResolvedValue(null);
    loadPersistedScrapeText.mockResolvedValue({
      snippets: [],
      siteContent: null,
    });
    getBrandFaqEntries.mockResolvedValue([]);
    getStockistsForBrand.mockResolvedValue({ confirmed: [], possible: [] });

    const accepted = [modelEntry("custom")];
    createClient.mockReturnValue({
      chat: vi.fn().mockResolvedValue({
        response: { ok: true },
        content: JSON.stringify({ entries: accepted }),
      }),
    });

    const output = await runFaqPhase({
      brand: ENRICH_BRAND,
      phases: ["faq"] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: [],
      target: { type: "submission", id: "sub-1" },
      pendingPatch: undefined,
    });

    expect(output.phaseResult.status).toBe("succeeded");
    expect(output.phaseResult.changedFields).toContain("faq");
    const faqPatch = (output.patch as Record<string, unknown>).faq as {
      entries: unknown[];
      explicit: boolean;
    };
    expect(faqPatch).toBeDefined();
    expect(faqPatch.entries.length).toBeGreaterThan(0);
    expect(faqPatch.explicit).toBe(false);
    expect(upsertBrandFaqEntries).not.toHaveBeenCalled();
    expect(getBrandById).not.toHaveBeenCalled();
  });

  it("omits_faq_key_when_nothing_accepted", async () => {
    getCategoryPeerStats.mockResolvedValue(null);
    loadPersistedScrapeText.mockResolvedValue({
      snippets: [],
      siteContent: null,
    });
    getBrandFaqEntries.mockResolvedValue([]);
    getStockistsForBrand.mockResolvedValue({ confirmed: [], possible: [] });

    createClient.mockReturnValue({
      chat: vi.fn().mockResolvedValue({
        response: { ok: true },
        content: JSON.stringify({ entries: [] }),
      }),
    });

    const output = await runFaqPhase({
      brand: ENRICH_BRAND,
      phases: ["faq"] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: [],
      target: { type: "submission", id: "sub-1" },
      pendingPatch: undefined,
    });

    expect(output.patch).toEqual({});
  });

  it("new_submission_authors_without_source_brand", async () => {
    const newBrand: EnrichBrand = {
      ...ENRICH_BRAND,
      source_brand_id: undefined,
    };
    getCategoryPeerStats.mockResolvedValue(null);
    loadPersistedScrapeText.mockResolvedValue({
      snippets: [],
      siteContent: null,
    });
    createClient.mockReturnValue({
      chat: vi.fn().mockResolvedValue({
        response: { ok: true },
        content: JSON.stringify({ entries: [modelEntry("custom")] }),
      }),
    });

    const output = await runFaqPhase({
      brand: newBrand,
      phases: ["faq"] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: [],
      target: { type: "submission", id: "sub-1" },
      pendingPatch: undefined,
    });

    expect(createClient).toHaveBeenCalled();
    expect(getBrandFaqEntries).not.toHaveBeenCalled();
    expect(getStockistsForBrand).not.toHaveBeenCalled();
    expect(output.phaseResult.status).toBe("succeeded");
  });

  it("refresh_short_circuit_still_reads_live_rows", async () => {
    const ctx = context({}, null);
    const presets = authorable(ctx);
    // Return complete coverage for every authorable preset
    const completeRows = presets.flatMap((preset) =>
      preset.id === "custom"
        ? Array.from({ length: CUSTOM_QUESTION_CEILING }, (_, index) => ({
            presetId: "custom",
            position: index,
            questionZh: "問題",
            answerZh: "回答",
            questionEn: "Question",
            answerEn: "Answer",
            source: "model" as const,
          }))
        : [
            {
              presetId: preset.id,
              position: 0,
              questionZh: "問題",
              answerZh: "回答",
              questionEn: "Question",
              answerEn: "Answer",
              source: "model" as const,
            },
          ],
    );
    getCategoryPeerStats.mockResolvedValue(null);
    loadPersistedScrapeText.mockResolvedValue({
      snippets: [],
      siteContent: null,
    });
    getBrandFaqEntries.mockResolvedValue(completeRows);
    getStockistsForBrand.mockResolvedValue({ confirmed: [], possible: [] });

    const output = await runFaqPhase({
      brand: ENRICH_BRAND,
      phases: ["faq"] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: [],
      target: { type: "submission", id: "sub-1" },
      pendingPatch: undefined,
    });

    expect(output.phaseResult.status).toBe("skipped");
    expect(output.phaseResult.detail).toContain("complete stored entry");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("explicit_flag_reflects_overwrite_or_explicit_phase", async () => {
    getCategoryPeerStats.mockResolvedValue(null);
    loadPersistedScrapeText.mockResolvedValue({
      snippets: [],
      siteContent: null,
    });
    getBrandFaqEntries.mockResolvedValue([]);
    getStockistsForBrand.mockResolvedValue({ confirmed: [], possible: [] });

    createClient.mockReturnValue({
      chat: vi.fn().mockResolvedValue({
        response: { ok: true },
        content: JSON.stringify({ entries: [modelEntry("custom")] }),
      }),
    });

    const output = await runFaqPhase({
      brand: ENRICH_BRAND,
      phases: ["faq"] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: [],
      target: { type: "submission", id: "sub-1" },
      pendingPatch: undefined,
      overwrite: true,
    });

    const faqPatch = (output.patch as Record<string, unknown>).faq as {
      entries: unknown[];
      explicit: boolean;
    };
    expect(faqPatch.explicit).toBe(true);
  });
});

describe("countWhereToBuy", () => {
  const pending = (name: string, address: string | null = null) => ({
    name,
    normalizedName: normalizeStockistName(name),
    address,
  });

  it("counts_live_rows_when_nothing_is_pending", () => {
    const live = {
      confirmed: [{ name: "誠品書店 信義店" }],
      possible: [{ name: "小器 赤峰" }],
    };
    expect(countWhereToBuy(live)).toBe(2);
    expect(countWhereToBuy(live, [])).toBe(2);
  });

  it("adds_pending_stockists_not_already_live", () => {
    const live = { confirmed: [{ name: "誠品書店 信義店" }], possible: [] };
    const existing = [
      {
        name: "誠品書店 信義店",
        normalized_name: normalizeStockistName("誠品書店 信義店"),
        address: null,
      },
    ];
    expect(
      countWhereToBuy(
        live,
        [
          // Same store, different whitespace: normalizes to the live name.
          pending("誠品書店信義店"),
          pending("小器 赤峰"),
          pending("好丘 信義"),
        ],
        existing,
      ),
    ).toBe(3);
  });

  it("counts_pending_alone_for_a_new_submission", () => {
    expect(countWhereToBuy(null, [pending("小器 赤峰")])).toBe(1);
    expect(countWhereToBuy(null)).toBe(0);
  });

  it("counts_a_repeated_pending_store_once", () => {
    expect(
      countWhereToBuy(null, [pending("小器 赤峰"), pending("小器赤峰")]),
    ).toBe(1);
  });

  it("skips_pending_stores_matching_a_rejected_or_removed_row", () => {
    // The upsert RPC never updates a rejected or removed row, so a store the
    // owner rejected stays off the page even when a refresh re-proposes it.
    const existing = [
      {
        name: "小器 赤峰",
        normalized_name: normalizeStockistName("小器 赤峰"),
        address: null,
        source: "enriched",
        owner_status: "rejected",
        removed_at: null,
      },
    ];
    expect(
      countWhereToBuy(
        { confirmed: [{ name: "誠品書店 信義店" }], possible: [] },
        [pending("小器 赤峰"), pending("好丘 信義")],
        existing,
      ),
    ).toBe(2);
    expect(countWhereToBuy(null, [pending("小器 赤峰")], existing)).toBe(0);
  });

  it("does_not_count_a_pending_near_duplicate_of_a_live_store", () => {
    // Staging `his-cross-concept` (DEV-1942): three live import rows and three
    // enriched candidates naming the same stores differently.
    const liveRows = [
      {
        name: "Rocco Coffee 若渴咖啡",
        address: "10491台北市中山區南京東路三段119號",
      },
      {
        name: "Standfirm｜HIS 特約專櫃",
        address: "台北市南港區南港路3段16巷8號2樓",
      },
      { name: "高雄以諾書房", address: "高雄市新興區中正三路70號" },
    ];
    const existing = liveRows.map((row) => ({
      ...row,
      normalized_name: normalizeStockistName(row.name),
    }));
    expect(
      countWhereToBuy({ confirmed: liveRows, possible: [] }, [
        pending("Rocco Coffee 若渴咖啡｜HIS 展售", "台北市中山區南京東路三段119號"),
        pending("台北 Standfirm 特約專櫃", "台北市南港區南港路三段16巷8號2樓"),
        pending("高雄以諾書房｜HIS 展售", "高雄市新興區中正三路70號"),
      ], existing),
    ).toBe(3);
  });

  it("skips_a_pending_store_matching_a_blocked_row_by_address", () => {
    const existing = [
      {
        name: "Standfirm｜HIS 特約專櫃",
        normalized_name: normalizeStockistName("Standfirm｜HIS 特約專櫃"),
        address: "台北市南港區南港路3段16巷8號2樓",
        owner_status: "rejected",
      },
    ];
    expect(
      countWhereToBuy(
        null,
        [pending("台北 Standfirm 特約專櫃", "台北市南港區南港路三段16巷8號2樓")],
        existing,
      ),
    ).toBe(0);
  });

  it("compares_live_rows_by_their_stored_normalized_name", () => {
    // The import region-suffixed the live row, so a pending `好丘` with no
    // address matches nothing and the upsert inserts it.
    const existing = [
      { name: "好丘", normalized_name: "好丘:台北市", address: null },
    ];
    expect(
      countWhereToBuy(
        { confirmed: [{ name: "好丘" }], possible: [] },
        [pending("好丘")],
        existing,
      ),
    ).toBe(2);
  });

  it("counts_exactly_the_rows_the_upsert_inserts", async () => {
    const address = "高雄市新興區中正三路70號";
    const existing: ExistingStockistRow[] = [
      { name: "好丘", normalized_name: "好丘:台北市", address: null },
      { name: "高雄以諾書房", normalized_name: "高雄以諾書房", address: null },
      {
        name: "小器 赤峰",
        normalized_name: "小器赤峰",
        address: null,
        owner_status: "rejected",
      },
      {
        name: "Standfirm",
        normalized_name: "standfirm",
        address: "台北市南港區南港路3段16巷8號2樓",
        source: "community",
        owner_status: "none",
        removed_at: null,
      },
    ];
    const candidates = [
      pending("高雄以諾書房｜HIS 展售", address),
      pending("高雄以諾書房", address),
      pending("好丘"),
      pending("小器 赤峰"),
      pending("台北 Standfirm", "台北市南港區南港路三段16巷8號2樓"),
    ];
    const liveCount = 2;

    let rpcRows: { normalized_name: string }[] = [];
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              range: async () => ({ data: existing, error: null }),
            }),
          }),
        }),
      }),
      rpc: async (_name: string, args: { p_candidates: typeof rpcRows }) => {
        rpcRows = args.p_candidates;
        return { data: null, error: null };
      },
    } as unknown as StockistsSupabase;
    await upsertEnrichedStockists("brand-1", candidates, { client });
    const existingNames = new Set(existing.map((row) => row.normalized_name));
    const inserted = rpcRows.filter(
      (row) => !existingNames.has(row.normalized_name),
    ).length;

    expect(inserted).toBe(2);
    expect(
      countWhereToBuy(
        { confirmed: [{}, {}], possible: [] },
        candidates,
        existing,
      ),
    ).toBe(liveCount + inserted);
  });
});

describe("resolvePendingStockists", () => {
  const stored = [
    { name: "小器 赤峰", normalizedName: normalizeStockistName("小器 赤峰") },
    { name: "好丘 信義", normalizedName: normalizeStockistName("好丘 信義") },
  ];
  const brandWithStored = {
    id: "submission-1",
    slug: "submission-submission-1",
    stockists: stored,
  } as EnrichBrand;

  it("falls_back_to_the_stockists_stored_on_the_submission", () => {
    const pendingStockists = resolvePendingStockists(undefined, brandWithStored);
    expect(pendingStockists).toEqual(stored);
    expect(countWhereToBuy(null, pendingStockists)).toBe(2);
  });

  it("prefers_this_runs_stockists_patch_over_the_stored_ones", () => {
    const fresh = stored.slice(0, 1);
    expect(resolvePendingStockists(fresh, brandWithStored)).toBe(fresh);
  });

  it("returns_none_when_nothing_is_pending_or_stored", () => {
    expect(
      resolvePendingStockists(undefined, { id: "s", slug: "s" }),
    ).toEqual([]);
  });
});
