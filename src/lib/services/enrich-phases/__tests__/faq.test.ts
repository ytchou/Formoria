import { describe, expect, it, vi } from "vitest";
import { DESCRIPTION_SYSTEM_PROMPT } from "@/lib/prompts";
import {
  ENRICH_PHASES,
  ENRICH_STAGE_GROUPS,
} from "@/lib/constants/enrich-phases";
import { eligibleFaqPresets } from "@/lib/brands/faq-presets";
import type { FaqBrandContext } from "@/lib/brands/faq-presets";
import type { Brand } from "@/lib/types";
import { resolveFaqAttempts, validateFaqEntries } from "../faq";

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
  productType: "crafts",
  city: "臺南",
  category: "手作工藝",
  isVerified: false,
  mitStatus: "unverified",
  mitStory: null,
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
  priceRange: null,
  productTags: [],
  productTagsEn: [],
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
  priceDistribution: { 1: 1, 2: 1, 3: 0 },
  cityClusters: [{ city: "臺南", count: 2 }],
};

function context(
  overrides: Partial<Brand> = {},
  peerStats: FaqBrandContext["peerStats"] = null,
): FaqBrandContext {
  const brand = { ...BRAND, ...overrides } as Brand;
  return { brand, cityLabel: brand.city, peerStats };
}

/** The model-authorable eligible set, exactly as the phase computes it. */
function authorable(ctx: FaqBrandContext) {
  return eligibleFaqPresets(ctx).filter(
    (preset) => preset.promptFragment !== null,
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

/** Same idea for the en 120–180 word band. */
function enAnswer(seed: string): string {
  const words = seed.split(/\s+/u);
  while (words.length < 140) words.push("grounded");
  return words.join(" ");
}

function modelEntry(
  presetId: string,
  overrides: { answerZh?: string; answerEn?: string } = {},
) {
  return {
    preset_id: presetId,
    question_zh: "這個品牌的特色是什麼？",
    answer_zh:
      overrides.answerZh ??
      zhAnswer("這個品牌以天然材料製作日用品，選料、裁切與手工縫製都在自有工坊完成。"),
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
    expect(ENRICH_PHASES.at(-1)).toBe("faq");
  });
});

describe("validateFaqEntries", () => {
  it("drops an answer for an ineligible preset", () => {
    // No product tags on file, so `main-products` never entered the prompt and
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
    expect(outcome.failures[0]?.presetId).toBe("main-products");
  });

  it("drops an answer containing an NT$ figure", () => {
    // `price-positioning` is eligible here, so the drop can only come from the
    // pricing check — not from eligibility or from a length miss.
    const ctx = context({ priceRange: 2 }, PEER_STATS);
    const presets = authorable(ctx);
    expect(presets.map((preset) => preset.id)).toContain("price-positioning");

    const clean = validateFaqEntries(
      { entries: [modelEntry("price-positioning")] },
      presets,
      ctx,
    );
    expect(clean.entries).toHaveLength(1);

    const outcome = validateFaqEntries(
      {
        entries: [
          modelEntry("price-positioning", {
            answerZh: zhAnswer("這個品牌的入門品項售價為 NT$ 800，屬於同類品牌的中段位置。"),
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
          failure.locale === "zh" && /pricing/i.test(failure.reason),
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
          modelEntry("custom", { answerZh: "沒有更多資訊。", answerEn: "None." }),
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
});

describe("resolveFaqAttempts", () => {
  it("retries once with a repair instruction on validation failure", async () => {
    const ctx = context();
    const presets = authorable(ctx);
    const send = vi
      .fn<
        (
          retryInstruction: string,
          attempt: number,
        ) => Promise<{ ok: boolean; content: string | null }>
      >()
      // Attempt 1 answers a preset that never entered the prompt.
      .mockResolvedValueOnce({
        ok: true,
        content: JSON.stringify({ entries: [modelEntry("main-products")] }),
      })
      // Attempt 2 answers an authorable one and clears validation.
      .mockResolvedValueOnce({
        ok: true,
        content: JSON.stringify({ entries: [modelEntry("custom")] }),
      });

    const outcome = await resolveFaqAttempts(presets, ctx, send);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBe("");
    expect(send.mock.calls[1]?.[0]).toContain("修復上一版 FAQ");
    expect(send.mock.calls[1]?.[0]).toContain("main-products");
    expect(outcome.entries).toHaveLength(1);
    expect(outcome.calls.attempted).toBe(2);
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

describe("DESCRIPTION_SYSTEM_PROMPT", () => {
  it("description prompt retains its channel and pricing prohibitions", () => {
    expect(DESCRIPTION_SYSTEM_PROMPT).toContain("購買管道與通路");
    expect(DESCRIPTION_SYSTEM_PROMPT).toContain("價格資訊一律不寫進這四個欄位");
    expect(DESCRIPTION_SYSTEM_PROMPT.toLowerCase()).not.toContain("faq");
  });
});
