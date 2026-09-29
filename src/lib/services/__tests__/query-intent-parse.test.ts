import { describe, expect, it, vi } from "vitest";
import {
  shouldAttemptIntentParse,
  parseQueryIntent,
  validateSubcategory,
  type IntentParseResult,
} from "../query-intent-parse";
import {
  INTENT_CATEGORY_MIN,
  INTENT_MATERIAL_MIN,
  INTENT_SUBCATEGORY_MIN,
} from "../intent-parse-jev";
import type { DecideFn, JevAnswers } from "../jev-candidate";
import type { IntentParseCache } from "@/lib/cache/intent-parse-cache";
import { MATERIALS } from "@/lib/taxonomy/ontology";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A fake audited `decide`: step 1 (the call carrying `category`) gets
 * `stepOne`, step 2 (the call carrying `subcategory`) gets `stepTwo`.
 */
function fakeDecide(stepOne: JevAnswers, stepTwo: JevAnswers = {}) {
  return vi.fn<DecideFn>(async (_profileKey, _state, questions) => ({
    answers: "category" in questions ? stepOne : stepTwo,
    usage: { inputTokens: 10, outputTokens: 2 },
    latencyMs: 5,
    costUsd: 0.0001,
  }));
}

function mockCache(
  store: Map<string, string> = new Map(),
): IntentParseCache & { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn(async (query: string) => store.get(query) ?? null),
    set: vi.fn(async (query: string, json: string) => {
      store.set(query, json);
    }),
  };
}

const CAMPING_SUB = "hiking-and-camping-gear";
const [MATERIAL_A, MATERIAL_B] = [MATERIALS[0]!.slug, MATERIALS[1]!.slug];

function outdoorAt(p: number): JevAnswers {
  return { category: { choice: "outdoor", probabilities: { outdoor: p } } };
}

function campingAt(p: number): JevAnswers {
  return { subcategory: { choice: CAMPING_SUB, probabilities: { [CAMPING_SUB]: p } } };
}

// ---------------------------------------------------------------------------
// shouldAttemptIntentParse
// ---------------------------------------------------------------------------

describe("shouldAttemptIntentParse", () => {
  it("returns true for a situation query with >= 6 CJK chars", () => {
    // 露營要帶的杯子 = 7 CJK chars
    expect(shouldAttemptIntentParse("露營要帶的杯子")).toBe(true);
  });

  it("returns false for a short keyword with < 6 CJK chars", () => {
    // 杯子 = 2 CJK chars
    expect(shouldAttemptIntentParse("杯子")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(shouldAttemptIntentParse("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseQueryIntent
// ---------------------------------------------------------------------------

describe("parseQueryIntent", () => {
  const VALID_RESPONSE: IntentParseResult = {
    category: "outdoor",
    subcategory: CAMPING_SUB,
    materials: [],
  };

  it("pins the tuned thresholds (DEV-1889)", () => {
    expect([INTENT_CATEGORY_MIN, INTENT_SUBCATEGORY_MIN, INTENT_MATERIAL_MIN]).toEqual([0.6, 0.9, 0.85]);
  });

  it("returns a null category below 0.6 and skips the step-2 call", async () => {
    const decide = fakeDecide(outdoorAt(0.59), campingAt(0.99));

    const result = await parseQueryIntent("想找一些特別的東西送人", { decide, cache: mockCache() });

    expect(result).toEqual({
      parsed: { category: null, subcategory: null, materials: [] },
      cacheHit: false,
    });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]?.[0]).toBe("intentParse");
    expect(decide.mock.calls[0]?.[1]).toEqual({ query: "想找一些特別的東西送人" });
  });

  it("keeps the category at 0.6 and asks step 2 within it", async () => {
    const decide = fakeDecide(outdoorAt(0.6), campingAt(0.5));

    const result = await parseQueryIntent("露營要帶什麼杯子", { decide, cache: mockCache() });

    expect(result!.parsed.category).toBe("outdoor");
    expect(result!.parsed.subcategory).toBeNull();
    expect(decide).toHaveBeenCalledTimes(2);
    expect(Object.keys(decide.mock.calls[1]![2])).toEqual(["subcategory"]);
  });

  it("keeps the subcategory at 0.9 and drops it at 0.89", async () => {
    const kept = await parseQueryIntent("露營要帶什麼杯子", {
      decide: fakeDecide(outdoorAt(0.8), campingAt(0.9)),
      cache: mockCache(),
    });
    expect(kept!.parsed).toEqual(VALID_RESPONSE);

    const dropped = await parseQueryIntent("露營要帶什麼杯子", {
      decide: fakeDecide(outdoorAt(0.8), campingAt(0.89)),
      cache: mockCache(),
    });
    expect(dropped!.parsed.subcategory).toBeNull();
  });

  it("counts a material at 0.85 and excludes it at 0.84", async () => {
    const decide = fakeDecide({
      ...outdoorAt(0.8),
      [MATERIAL_A]: { noul: 0.85 },
      [MATERIAL_B]: { noul: 0.84 },
    });

    const result = await parseQueryIntent("露營要帶什麼木頭杯子", { decide, cache: mockCache() });

    expect(result!.parsed.materials).toEqual([MATERIAL_A]);
  });

  it("never returns a subcategory outside the chosen category", async () => {
    // earrings belongs to jewelry, not outdoor
    const decide = fakeDecide(outdoorAt(0.8), {
      subcategory: { choice: "earrings", probabilities: { earrings: 0.99 } },
    });

    const result = await parseQueryIntent("露營要帶什麼東西出門", { decide, cache: mockCache() });

    expect(result!.parsed.category).toBe("outdoor");
    expect(result!.parsed.subcategory).toBeNull();
  });

  it("returns null when decide throws (timeout, API error)", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const decide = vi.fn<DecideFn>().mockRejectedValue(abortError);
    const cache = mockCache();

    const result = await parseQueryIntent("露營要帶什麼杯子呢", { decide, cache });

    expect(result).toBeNull();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("returns null when Jev gives no usable category", async () => {
    const decide = fakeDecide({});

    const result = await parseQueryIntent("露營要帶什麼杯子呢", { decide, cache: mockCache() });

    expect(result).toBeNull();
  });

  it("checks cache first and skips decide on cache hit", async () => {
    const store = new Map<string, string>();
    store.set("露營要帶什麼杯子", JSON.stringify(VALID_RESPONSE));
    const decide = fakeDecide(outdoorAt(0.9));

    const result = await parseQueryIntent("露營要帶什麼杯子", { decide, cache: mockCache(store) });

    expect(result).toEqual({ parsed: VALID_RESPONSE, cacheHit: true });
    expect(decide).not.toHaveBeenCalled();
  });

  it("writes to cache on successful parse", async () => {
    const cache = mockCache();

    await parseQueryIntent("露營要帶什麼杯子呢", {
      decide: fakeDecide(outdoorAt(0.8), campingAt(0.95)),
      cache,
    });

    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith("露營要帶什麼杯子呢", JSON.stringify(VALID_RESPONSE));
  });

  it("validates subcategory on cache hit (F4)", async () => {
    // A stale entry with a subcategory that doesn't match its category
    const staleEntry = JSON.stringify({
      category: "outdoor",
      subcategory: "earrings", // belongs to jewelry, not outdoor
      materials: [],
    });
    const store = new Map<string, string>();
    store.set("露營要帶什麼東西好", staleEntry);
    const decide = fakeDecide(outdoorAt(0.9));

    const result = await parseQueryIntent("露營要帶什麼東西好", { decide, cache: mockCache(store) });

    expect(result!.cacheHit).toBe(true);
    expect(result!.parsed.subcategory).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it("validates nonexistent subcategory on cache hit (F4+F3)", async () => {
    const staleEntry = JSON.stringify({
      category: null,
      subcategory: "bogus-slug",
      materials: [],
    });
    const store = new Map<string, string>();
    store.set("想找一些特別的禮物", staleEntry);

    const result = await parseQueryIntent("想找一些特別的禮物", {
      decide: fakeDecide(outdoorAt(0.9)),
      cache: mockCache(store),
    });

    expect(result!.cacheHit).toBe(true);
    expect(result!.parsed.subcategory).toBeNull();
  });
});

describe("validateSubcategory", () => {
  it("nulls a subcategory of another category or one outside the taxonomy", () => {
    expect(validateSubcategory({ category: "outdoor", subcategory: "earrings", materials: [] }).subcategory).toBeNull();
    expect(validateSubcategory({ category: null, subcategory: "bogus-slug", materials: [] }).subcategory).toBeNull();
    expect(validateSubcategory({ category: "outdoor", subcategory: CAMPING_SUB, materials: [] }).subcategory).toBe(CAMPING_SUB);
  });
});
