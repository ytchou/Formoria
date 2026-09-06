import { describe, expect, it, vi } from "vitest";
import {
  validateStockistCandidates,
  filterStockistEvidence,
} from "../stockists";

vi.mock("@/lib/langfuse/prompt", () => ({
  fetchLangfusePrompt: vi.fn((_n: string, fb: string) => Promise.resolve(fb)),
  fetchLangfusePromptWithMeta: vi.fn((_n: string, fb: string) =>
    Promise.resolve({ text: fb, prompt: { name: _n, version: 1 } }),
  ),
}));
import { MAX_ACTIVE_STOCKISTS_PER_BRAND } from "../../stockists";

describe("validateStockistCandidates", () => {
  const validEntry = {
    name: "誠品書店 信義店",
    regionSlug: "taipei",
    address: "台北市信義區松高路11號",
    locationType: "stockist" as const,
    sourceUrl: "https://example.com/stores",
  };

  it("rejects entries with no name", () => {
    const result = validateStockistCandidates([
      { ...validEntry, name: "" },
      { ...validEntry, name: "   " },
      validEntry,
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe(validEntry.name);
  });

  it("rejects invalid regionSlug", () => {
    const result = validateStockistCandidates([
      { ...validEntry, regionSlug: "mars" },
      { ...validEntry, regionSlug: "taipei" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].regionLabel).toBe("臺北市");
  });

  it("caps at MAX_ACTIVE_STOCKISTS_PER_BRAND", () => {
    const entries = Array.from({ length: 7 }, (_, i) => ({
      ...validEntry,
      name: `Store ${i}`,
    }));
    const result = validateStockistCandidates(entries);
    expect(result).toHaveLength(MAX_ACTIVE_STOCKISTS_PER_BRAND);
  });

  it("computes normalizedName via normalizeStockistName", () => {
    const result = validateStockistCandidates([validEntry]);
    expect(result[0].normalizedName).toBeDefined();
    // normalizedName is code-derived, not whatever the LLM might have said
    expect(typeof result[0].normalizedName).toBe("string");
    expect(result[0].normalizedName.length).toBeGreaterThan(0);
  });

  it("sets provenance fields", () => {
    const result = validateStockistCandidates([validEntry]);
    expect(result[0].source).toBe("enriched");
    expect(result[0].country).toBe("TW");
  });
});

describe("filterStockistEvidence", () => {
  it("returns null for text with no signal words", () => {
    const text = "This is a general paragraph about the company history.\nAnother paragraph about the team.";
    expect(filterStockistEvidence(text)).toBeNull();
  });

  it("passes through lines with signal words", () => {
    const text = [
      "About our company and founders.",
      "我們在台北有一間門市，歡迎來逛逛。",
      "Our team values quality and craftsmanship.",
    ].join("\n");
    const result = filterStockistEvidence(text);
    expect(result).not.toBeNull();
    expect(result).toContain("門市");
    expect(result).not.toContain("founders");
  });

  it("passes stockistPageText unfiltered", () => {
    const text = [
      "Stockist Page: Some random text without keywords here that should still pass through completely.",
      "Another paragraph without keywords that should be dropped.",
    ].join("\n");
    const result = filterStockistEvidence(text);
    expect(result).not.toBeNull();
    expect(result).toContain("Some random text without keywords");
    expect(result).not.toContain("Another paragraph without keywords");
  });

  it("handles leading whitespace on Stockist Page prefix", () => {
    const text = "  Stockist Page: indented content here";
    const result = filterStockistEvidence(text);
    expect(result).not.toBeNull();
    expect(result).toContain("Stockist Page: indented content here");
  });
});
