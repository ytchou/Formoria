import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import zhMessages from "../../../../../messages/zh-TW.json";
import type { Brand } from "@/lib/types";
import { TAIWAN_USAGE_RULES } from "@/lib/prompts";
import {
  FAQ_PRESETS,
  FAQ_PROMPT_PREAMBLE,
  buildFaqPromptHash,
  buildFaqSystemPrompt,
  eligibleFaqPresets,
} from "../index";
import type {
  FaqBrandContext,
  FaqPreset,
  FaqValidatorContext,
} from "../types";
import {
  noPricingFigures,
  notDuplicateOf,
  withinLengthBand,
} from "../validators";

type MessageNode = string | { [key: string]: MessageNode };

const brandDetail = zhMessages.brandDetail as MessageNode;

function resolveBrandDetail(
  key: string,
  values: Record<string, unknown> = {},
): string {
  const node = key.split(".").reduce<MessageNode | undefined>((current, part) => {
    if (!current || typeof current === "string") return undefined;
    return current[part];
  }, brandDetail);

  if (typeof node !== "string") {
    throw new Error(`Missing brandDetail message: ${key}`);
  }

  return node.replace(/\{(\w+)\}/gu, (_, name: string) =>
    String(values[name] ?? `{${name}}`),
  );
}

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: "brand-subject",
    name: "Harbor Form",
    slug: "harbor-form",
    description: "A small Taiwanese design brand.",
    descriptionEn: "A small Taiwanese design brand.",
    blurb: null,
    blurbEn: null,
    heroImageUrl: null,
    status: "approved",
    productType: "crafts",
    category: "工藝文創",
    city: "taipei",
    isVerified: false,
    mitStatus: undefined,
    mitDeclaredScope: null,
    mitDeclaredAt: null,
    mitVerifiedAt: null,
    mitEvidence: null,
    mitVerified: false,
    mitStory: null,
    isDemo: false,
    foundingYear: 2021,
    reputationSummary: {
      text: "Featured by a named design publication.",
      textEn: "Featured by a named design publication.",
      sources: [{ url: "https://example.com/feature" }],
    },
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: "https://harbor.example.com",
    purchasePinkoi: null,
    purchaseShopee: null,
    purchaseMyship: null,
    otherUrls: [],
    productPhotos: [],
    imageAlts: [],
    contactEmail: null,
    priceRange: 2,
    productTags: ["陶藝", "茶具"],
    productTagsEn: ["ceramics", "tea ware"],
    siteContent: null,
    submittedAt: "2026-01-01T00:00:00.000Z",
    approvedAt: "2026-01-02T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    onboardingDismissedAt: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<FaqBrandContext> = {}): FaqBrandContext {
  return {
    brand: makeBrand(),
    cityLabel: "taipei",
    peerStats: {
      peerCount: 4,
      priceDistribution: { 1: 1, 2: 2, 3: 1 },
      cityClusters: [{ city: "Taipei", count: 2 }],
    },
    ...overrides,
  };
}

/** Validators receive the brand *context*, not the raw brand row. */
function makeValidatorContext(
  locale: FaqValidatorContext["locale"],
  siblings: readonly string[] = [],
): FaqValidatorContext {
  return { locale, brand: makeContext(), siblings };
}

function assertPresetShape(preset: FaqPreset): void {
  expect(typeof preset.id).toBe("string");
  expect(typeof preset.eligible).toBe("function");
  expect(Array.isArray(preset.requiredEvidence)).toBe(true);
  expect(preset.templateFloor === null || typeof preset.templateFloor === "function").toBe(true);
  expect(preset.promptFragment === null || typeof preset.promptFragment === "function").toBe(true);
  expect(Array.isArray(preset.validators)).toBe(true);
}

describe("FAQ preset catalog", () => {
  it("every preset id is unique and stable", () => {
    expect(FAQ_PRESETS.map((preset) => preset.id)).toEqual([
      "taiwan-origin",
      "category-position",
      "main-products",
      "price-positioning",
      "reputation",
      "custom",
    ]);
    expect(new Set(FAQ_PRESETS.map((preset) => preset.id)).size).toBe(
      FAQ_PRESETS.length,
    );
    FAQ_PRESETS.forEach(assertPresetShape);
  });

  it("eligibility gates on required evidence", () => {
    const withoutEvidence = makeContext({
      peerStats: null,
      brand: makeBrand({
        productType: null,
        productTags: [],
        priceRange: null,
        reputationSummary: null,
      }),
    });
    const eligible = eligibleFaqPresets(withoutEvidence).map(
      (preset) => preset.id,
    );

    // Every evidence-gated preset drops out. `taiwan-origin` and `custom`
    // carry no `requiredEvidence`, so they are the only survivors.
    expect(eligible).toEqual(["taiwan-origin", "custom"]);
    for (const preset of FAQ_PRESETS) {
      if (preset.requiredEvidence.length === 0) continue;
      expect(preset.eligible(withoutEvidence)).toBe(false);
    }
    expect(
      FAQ_PRESETS.find((preset) => preset.id === "category-position")
        ?.requiredEvidence,
    ).toEqual(["productType", "peerStats"]);
  });

  it("taiwan-origin is eligible for a brand with no mit_status", () => {
    const preset = FAQ_PRESETS[0];
    const context = makeContext({ brand: makeBrand({ mitStatus: undefined }) });

    expect(preset.id).toBe("taiwan-origin");
    expect(preset.eligible(context)).toBe(true);
  });

  it("undeclared taiwan-origin floor states verification was not submitted and claims no MIT status", () => {
    const preset = FAQ_PRESETS[0];
    const context = makeContext({
      brand: makeBrand({ mitStatus: "unverified" }),
    });
    const floor = preset.templateFloor?.(context, resolveBrandDetail, "zh");
    const contextSuffix = resolveBrandDetail("brandFaq.context.suffix", {
      details: [
        resolveBrandDetail("brandFaq.context.city", { city: "taipei" }),
        resolveBrandDetail("brandFaq.context.founded", { year: 2021 }),
      ].join(resolveBrandDetail("brandFaq.listSeparator")),
    });

    expect(floor).toBe(
      resolveBrandDetail("brandFaq.taiwanOrigin.undeclaredAnswer", {
        brandName: context.brand.name,
        context: contextSuffix,
      }),
    );
    expect(floor).toContain("尚未");
    expect(floor).toContain("沒有台灣製造");
    expect(floor).not.toContain("已驗證");
    expect(floor).not.toContain("通過驗證");
    expect(floor).not.toContain(resolveBrandDetail("brandFaq.isMadeInTaiwan.registrySource"));
  });

  it("assembled prompt contains only eligible fragments", () => {
    const context = makeContext({
      brand: makeBrand({ reputationSummary: null }),
    });
    const eligible = eligibleFaqPresets(context);
    const prompt = buildFaqSystemPrompt(eligible, context);

    expect(prompt).toContain(FAQ_PROMPT_PREAMBLE);
    // The Taiwan-usage rules are reused from the description prompt, not a fork.
    expect(prompt).toContain(TAIWAN_USAGE_RULES);
    for (const preset of FAQ_PRESETS) {
      const fragment = preset.promptFragment?.(context);
      if (fragment === undefined) continue;
      if (eligible.includes(preset)) {
        expect(prompt).toContain(fragment);
      } else {
        expect(prompt).not.toContain(fragment);
      }
    }
  });

  it("promptHash is stable across brands with the same eligible set", () => {
    const first = makeContext({ brand: makeBrand({ id: "first", name: "First Harbor" }) });
    const second = makeContext({ brand: makeBrand({ id: "second", name: "Second Harbor" }) });
    const firstEligible = eligibleFaqPresets(first);
    const secondEligible = eligibleFaqPresets(second);

    expect(firstEligible.map((preset) => preset.id)).toEqual(
      secondEligible.map((preset) => preset.id),
    );
    expect(buildFaqPromptHash(firstEligible)).toBe(
      buildFaqPromptHash(secondEligible),
    );
    // The hash is over the preamble plus the sorted ids of the presets that
    // actually contribute a fragment — never the rendered, brand-specific
    // string, which differs between these two brands.
    expect(buildFaqSystemPrompt(firstEligible, first)).not.toBe(
      buildFaqSystemPrompt(secondEligible, second),
    );
    expect(buildFaqPromptHash(firstEligible)).toBe(
      createHash("sha256")
        .update(
          [
            FAQ_PROMPT_PREAMBLE,
            ...firstEligible
              .filter((preset) => preset.promptFragment !== null)
              .map((preset) => preset.id)
              .sort(),
          ].join("\n"),
        )
        .digest("hex")
        .slice(0, 12),
    );
  });

  it("noPricingFigures rejects an NT$ answer", () => {
    const result = noPricingFigures()(
      "這項產品售價為 NT$1,200，屬於中價位。",
      makeValidatorContext("zh"),
    );

    expect(result.ok).toBe(false);
  });

  it("lengthBand rejects an out-of-band zh answer", () => {
    // 40 字 — well short of the zh 200–320 band.
    const shortAnswer = "這個品牌以陶藝與茶具為主要產品，於台北設立".repeat(2);

    expect(Array.from(shortAnswer).length).toBeLessThan(200);
    expect(withinLengthBand()(shortAnswer, makeValidatorContext("zh")).ok).toBe(
      false,
    );
  });

  it("notDuplicateOf rejects a custom restating a preset topic", () => {
    const presetAnswer = "Harbor Form makes ceramics and tea ware in Taipei.";
    const result = notDuplicateOf([presetAnswer])(
      presetAnswer,
      makeValidatorContext("en"),
    );

    expect(result.ok).toBe(false);
  });
});
