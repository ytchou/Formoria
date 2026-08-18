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
    categorySlug: "crafts",
    categoryLabel: "工藝文創",
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
    subcategories: ["陶藝", "茶具"],
    subcategoriesEn: ["ceramics", "tea ware"],
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
  // A renderable preset carries its question key and its floor as one field,
  // so a floor can never ship without the question it renders under.
  if (preset.render !== null) {
    expect(typeof preset.render.questionKey).toBe("string");
    expect(typeof preset.render.templateFloor).toBe("function");
  }
  expect(preset.promptFragment === null || typeof preset.promptFragment === "function").toBe(true);
  expect(Array.isArray(preset.validators)).toBe(true);
}

function presetById(id: string): FaqPreset {
  const found = FAQ_PRESETS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown preset: ${id}`);
  return found;
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

  it("authoring eligibility gates on required evidence", () => {
    const withoutEvidence = makeContext({
      peerStats: null,
      brand: makeBrand({
        categorySlug: null,
        subcategories: [],
        subcategoriesEn: [],
        priceRange: null,
        reputationSummary: null,
      }),
    });
    const eligible = eligibleFaqPresets(withoutEvidence).map(
      (item) => item.id,
    );

    // Every evidence-gated preset drops out. `custom` carries no
    // `requiredEvidence` and is the only survivor; taiwan-origin still needs
    // an actual MIT verification before its template floor can render.
    expect(eligible).toEqual(["custom"]);
    for (const item of FAQ_PRESETS) {
      if (item.requiredEvidence.length === 0) continue;
      expect(item.eligible(withoutEvidence)).toBe(false);
    }
    expect(presetById("category-position").requiredEvidence).toEqual([
      "categorySlug",
      "peerStats",
    ]);
  });

  // The two predicates answer different questions. Render eligibility asks
  // whether the floor can be computed from evidence the *page request* has;
  // authoring eligibility asks whether the model has enough to write from.
  // Conflating them made the price floor unreachable at render time.
  it("price-positioning renders on price_range alone but authors only with peer stats", () => {
    const withoutPeers = makeContext({ peerStats: null });
    const pricePositioning = presetById("price-positioning");

    expect(pricePositioning.eligible(withoutPeers)).toBe(true);
    expect(pricePositioning.authorable?.(withoutPeers)).toBe(false);
    expect(pricePositioning.authorable?.(makeContext())).toBe(true);
    expect(
      eligibleFaqPresets(withoutPeers).map((item) => item.id),
    ).not.toContain("price-positioning");

    const noPrice = makeContext({ brand: makeBrand({ priceRange: null }) });
    expect(pricePositioning.eligible(noPrice)).toBe(false);
  });

  it("main-products render eligibility is per locale", () => {
    const mainProducts = presetById("main-products");
    const zhOnly = makeContext({
      brand: makeBrand({ subcategories: ["陶藝"], subcategoriesEn: [] }),
    });

    expect(mainProducts.eligible(zhOnly, "zh-TW")).toBe(true);
    // An en render would interpolate an empty tag list into the page and the
    // FAQPage JSON-LD.
    expect(mainProducts.eligible(zhOnly, "en")).toBe(false);
    // Authoring still runs: the model writes both sides from the zh evidence.
    expect(mainProducts.authorable?.(zhOnly)).toBe(true);
  });

  it("derives groundedIn from requiredEvidence for every preset that declares it", () => {
    const withoutPeers = makeContext({ peerStats: null });

    for (const item of FAQ_PRESETS) {
      if (item.requiredEvidence.length === 0) continue;
      const results = item.validators.map((validate) =>
        validate("任意內容", { locale: "zh", brand: withoutPeers, siblings: [] }),
      );
      if (!item.requiredEvidence.includes("peerStats")) continue;
      // No hand-written groundedIn call remains in the preset files, so this
      // failing proves the registry derived one from the declaration.
      expect(
        results.some(
          (result) => !result.ok && /Required evidence/.test(result.reason ?? ""),
        ),
      ).toBe(true);
    }
  });

  it("every model-authored preset rejects an NT$ figure on pricing grounds", () => {
    const answer = "入門款約 NT$1,280 起，屬於中價位。";

    for (const item of FAQ_PRESETS) {
      // A null promptFragment means the copy is code-derived, never authored.
      if (item.promptFragment === null) continue;
      const reasons = item.validators
        .map((validate) => validate(answer, makeValidatorContext("zh")))
        .filter((result) => !result.ok)
        .map((result) => result.reason ?? "");

      expect(
        reasons.some((reason) => /pricing/i.test(reason)),
        `${item.id} has no pricing validator`,
      ).toBe(true);
    }
  });

  it("the shared preamble states the currency prohibition once for all presets", () => {
    expect(FAQ_PROMPT_PREAMBLE).toContain("NT$");
    expect(FAQ_PROMPT_PREAMBLE).toContain("禁止價格數字");
  });

  it("renders the zh-TW price floor without duplicating the range label", () => {
    const preset = presetById("price-positioning");
    const answer = preset.render?.templateFloor(
      makeContext({ brand: makeBrand({ priceRange: 2 }) }),
      resolveBrandDetail,
      "zh-TW",
    );

    expect(answer).toBe("Harbor Form 的產品定位在中價位。");
  });

  it("taiwan-origin template floor requires verified MIT status", () => {
    const preset = presetById("taiwan-origin");

    expect(preset.id).toBe("taiwan-origin");
    expect(
      preset.eligible(
        makeContext({ brand: makeBrand({ mitStatus: "verified" }) }),
      ),
    ).toBe(true);

    for (const mitStatus of [undefined, "unverified", "declared"] as const) {
      expect(
        preset.eligible(makeContext({ brand: makeBrand({ mitStatus }) })),
      ).toBe(false);
    }
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
