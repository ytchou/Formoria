import { describe, expect, it, vi } from "vitest";
import { DESCRIPTION_SYSTEM_PROMPT } from "@/lib/prompts";
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
import { TAIWAN_USAGE_RULES } from "@/lib/prompts/shared";
import type { BrandFaqEntryRow } from "../../brand-faq";
import type { EnrichBrand, EnrichPhase } from "../types";
import {
  contextFacts,
  faqCoverageIsComplete,
  localizedCityLabel,
  resolveFaqAttempts,
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
  vi.fn((_name: string, fallback: string) => Promise.resolve(fallback)),
);
vi.mock("@/lib/langfuse/prompt", () => ({ fetchLangfusePrompt }));

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
vi.mock("../../brand-faq", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brand-faq")>()),
  getBrandFaqEntries,
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
  material: [],
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
  logoUrl: null,
} as Brand;

const PEER_STATS: NonNullable<FaqBrandContext["peerStats"]> = {
  peerCount: 2,
  cityClusters: [{ city: "臺南", count: 2 }],
};

function context(
  overrides: Partial<Brand> = {},
  peerStats: FaqBrandContext["peerStats"] = null,
): FaqBrandContext {
  const brand = { ...BRAND, ...overrides } as Brand;
  return { brand, cityLabel: localizedCityLabel(brand.city), peerStats };
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

  it("faq runs after descriptions and reputation", () => {
    expect(ENRICH_PHASES.indexOf("faq")).toBeGreaterThan(
      ENRICH_PHASES.indexOf("descriptions"),
    );
    expect(ENRICH_PHASES.indexOf("faq")).toBeGreaterThan(
      ENRICH_PHASES.indexOf("reputation"),
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
    // `category-position` is eligible here, so the drop can only come from the
    // commerce check — not from eligibility.
    const ctx = context({}, PEER_STATS);
    const presets = authorable(ctx);
    expect(presets.map((preset) => preset.id)).toContain("category-position");

    const clean = validateFaqEntries(
      { entries: [modelEntry("category-position")] },
      presets,
      ctx,
    );
    expect(clean.entries).toHaveLength(1);

    const outcome = validateFaqEntries(
      {
        entries: [
          modelEntry("category-position", {
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
    const ctx = context({}, PEER_STATS);
    const presets = authorable(ctx);

    const outcome = validateFaqEntries(
      {
        entries: [
          modelEntry("category-position"),
          modelEntry("category-position", {
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

    const categoryEntries = outcome.entries.filter(
      (entry) => entry.presetId === "category-position",
    );
    expect(categoryEntries).toHaveLength(1);
    expect(categoryEntries[0]?.position).toBe(0);
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

  // Peer stats make the set wider than `custom` alone —
  // a single-preset set would not show the per-preset accounting at all.
  const presets = authorable(context({}, PEER_STATS));

  it("covers a set wider than custom alone", () => {
    expect(
      presets.filter((preset) => preset.id !== "custom").length,
    ).toBeGreaterThan(0);
  });

  it("is complete when every authorable preset has a two-locale entry", () => {
    const rows = presets.flatMap((preset) =>
      preset.id === "custom"
        ? Array.from({ length: CUSTOM_QUESTION_CEILING }, (_, index) =>
            row("custom", index),
          )
        : [row(preset.id)],
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
    const ctx = context({}, PEER_STATS);
    const presets = authorable(ctx);
    const send = vi
      .fn<
        (
          retryInstruction: string,
          attempt: number,
        ) => Promise<{ ok: boolean; content: string | null }>
      >()
      // Attempt 1 puts a currency figure in the factual category answer — a real
      // repairable rejection, the kind the second call exists for.
      .mockResolvedValueOnce({
        ok: true,
        content: JSON.stringify({
          entries: [
            modelEntry("category-position", {
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
        content: JSON.stringify({ entries: [modelEntry("category-position")] }),
      });

    const outcome = await resolveFaqAttempts(presets, ctx, send);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBe("");
    expect(send.mock.calls[1]?.[0]).toContain("修復上一版 FAQ");
    expect(send.mock.calls[1]?.[0]).toContain("category-position");
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
    const ctx = context({}, PEER_STATS);
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
            modelEntry("category-position", {
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
            modelEntry("category-position", {
              answerZh: zhAnswer(
                "這個類別共有兩個品牌，兩者都位於臺南，資料僅描述類別規模與地理分布。",
              ),
              answerEn: enAnswer(
                "This category contains two brands, both located in Tainan.",
              ),
            }),
          ],
        }),
      });

    const outcome = await resolveFaqAttempts(presets, ctx, send);

    expect(send).toHaveBeenCalledTimes(2);
    const presetIds = outcome.entries.map((entry) => entry.presetId).sort();
    expect(presetIds).toEqual(["category-position", "custom"]);
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
});

describe("DESCRIPTION_SYSTEM_PROMPT", () => {
  it("description prompt retains its channel and pricing prohibitions", () => {
    expect(DESCRIPTION_SYSTEM_PROMPT).toContain("Purchase channels and distribution");
    expect(DESCRIPTION_SYSTEM_PROMPT).toContain("pricing information is never written in these four fields");
    expect(DESCRIPTION_SYSTEM_PROMPT.toLowerCase()).not.toContain("faq");
  });
});

describe("runFaqPhase langfuse variables", () => {
  it("faq_variables_passed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    getBrandById.mockResolvedValue({ ...BRAND, categorySlug: "home" });
    getCategoryPeerStats.mockResolvedValue(null);
    loadPersistedScrapeText.mockResolvedValue({
      snippets: [],
      siteContent: null,
    });
    getBrandFaqEntries.mockResolvedValue([]);
    createClient.mockReturnValue({
      chat: vi.fn().mockResolvedValue({
        response: { ok: true },
        content: JSON.stringify({ entries: [] }),
      }),
    });

    await runFaqPhase({
      brand: BRAND as unknown as EnrichBrand,
      phases: ["faq"] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: [],
    });

    expect(fetchLangfusePrompt).toHaveBeenCalledWith(
      "faq-preamble",
      expect.any(String),
      expect.objectContaining({ taiwan_usage_rules: TAIWAN_USAGE_RULES }),
    );

    vi.unstubAllEnvs();
  });
});
