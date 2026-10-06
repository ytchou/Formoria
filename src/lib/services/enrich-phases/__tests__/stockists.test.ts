import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  validateStockistCandidates,
  filterStockistEvidence,
  attributeSourceUrls,
  runStockistsPhase,
} from "../stockists";
import {
  STOCKISTS_NO_EVIDENCE_SKIP_DETAIL,
  STOCKISTS_NO_SIGNAL_SKIP_DETAIL,
  STOCKISTS_NONE_FOUND_SKIP_DETAIL,
  type EnrichBrand,
  type EnrichPhase,
} from "../types";

/**
 * `llm-audit` wraps the OpenAI adapter and is on the boundary allowlist in
 * `check:test-boundaries`. The persisted-scrape reader is injected through
 * `deps` instead of mocked, because it is an internal service.
 */
const createClient = vi.hoisted(() => vi.fn());
vi.mock("../../llm-audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../llm-audit")>()),
  createProfiledOpenAIClient: createClient,
}));

vi.mock("@/lib/langfuse/prompt", () => ({
  fetchLangfusePrompt: vi.fn((_n: string) => Promise.resolve("mock-prompt")),
  fetchLangfusePromptWithMeta: vi.fn((_n: string) =>
    Promise.resolve({ text: "mock-prompt", prompt: { name: _n, version: 1, source: "langfuse" } }),
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

  // DEV-1941: `/store/` in a Pinkoi URL matched the "store" signal word, so the
  // URL line alone survived and the model cited it for another site's stockists.
  it("drops a URL line whose section contributes no evidence", () => {
    const text = [
      "URL: https://www.pinkoi.com/store/histhygift",
      "Description: 手作杯子與生活小物",
    ].join("\n");
    expect(filterStockistEvidence(text)).toBeNull();
  });

  it("keeps the URL line ahead of the section it labels", () => {
    const text = [
      "URL: https://www.pinkoi.com/store/histhygift",
      "Description: 手作杯子與生活小物",
      "URL: https://histhygift.com",
      "Stockist Page: 若渴咖啡 高雄市新興區",
    ].join("\n");
    expect(filterStockistEvidence(text)).toBe(
      "URL: https://histhygift.com\nStockist Page: 若渴咖啡 高雄市新興區",
    );
  });
});

describe("attributeSourceUrls", () => {
  const [candidate] = validateStockistCandidates([
    {
      name: "若渴咖啡",
      regionSlug: "kaohsiung",
      address: null,
      locationType: "stockist",
      sourceUrl: "https://www.pinkoi.com/store/histhygift",
    },
  ]);

  it("replaces a cited URL absent from the evidence with the only evidence URL", () => {
    const evidence = "URL: https://histhygift.com\nStockist Page: 若渴咖啡";
    expect(attributeSourceUrls([candidate], evidence)[0].sourceUrl).toBe(
      "https://histhygift.com",
    );
  });

  it("keeps a cited URL that labels an evidence section", () => {
    const evidence = [
      "URL: https://a.example.com",
      "Stockist Page: 若渴咖啡",
      "URL: https://www.pinkoi.com/store/histhygift",
      "Description: 門市在高雄",
    ].join("\n");
    expect(attributeSourceUrls([candidate], evidence)[0].sourceUrl).toBe(
      "https://www.pinkoi.com/store/histhygift",
    );
  });

  it("clears a cited URL absent from evidence that has several sections", () => {
    const evidence = [
      "URL: https://a.example.com",
      "Stockist Page: 若渴咖啡",
      "URL: https://b.example.com",
      "Description: 門市在高雄",
    ].join("\n");
    expect(attributeSourceUrls([candidate], evidence)[0].sourceUrl).toBeNull();
  });
});

describe("runStockistsPhase", () => {
  const brand: EnrichBrand = {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "island-studio",
    name: "小島工坊",
  };
  const target = {
    type: "submission" as const,
    id: "00000000-0000-4000-8000-000000000002",
  };
  const phases = ["stockists"] as EnrichPhase[];
  const modelEntry = {
    name: "誠品書店 信義店",
    regionSlug: "taipei",
    address: "台北市信義區松高路11號",
    locationType: "stockist",
    sourceUrl: "https://example.com/stores",
  };
  const scrape = (siteContent: string | null) =>
    vi.fn().mockResolvedValue({ snippets: [], siteContent });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs for a submission target and returns the candidates as a patch", async () => {
    createClient.mockReturnValue({
      chat: vi.fn().mockResolvedValue({
        response: { ok: true },
        content: JSON.stringify({ stockists: [modelEntry] }),
      }),
    });

    const output = await runStockistsPhase({
      brand,
      phases,
      target,
      deps: {
        loadPersistedScrapeText: scrape(
          "URL: https://example.com/stores\n我們的門市在台北信義區，歡迎參觀。",
        ),
      },
    });

    expect(output.phaseResult.status).toBe("succeeded");
    expect(output.phaseResult.changedFields).toEqual(["1 stockist(s)"]);
    const [expected] = validateStockistCandidates([modelEntry]);
    expect(output.patch.stockists).toEqual([
      { ...expected, fetchedAt: expect.any(String) },
    ]);
  });

  it("cites the evidence section's URL, not the URL the model guessed", async () => {
    createClient.mockReturnValue({
      chat: vi.fn().mockResolvedValue({
        response: { ok: true },
        content: JSON.stringify({
          stockists: [
            { ...modelEntry, sourceUrl: "https://www.pinkoi.com/store/histhygift" },
          ],
        }),
      }),
    });

    const output = await runStockistsPhase({
      brand,
      phases,
      target,
      deps: {
        loadPersistedScrapeText: scrape(
          [
            "URL: https://www.pinkoi.com/store/histhygift",
            "Description: 手作杯子與生活小物",
            "URL: https://histhygift.com",
            "Stockist Page: 誠品書店 信義店 台北市信義區松高路11號",
          ].join("\n"),
        ),
      },
    });

    expect(output.patch.stockists?.[0].sourceUrl).toBe("https://histhygift.com");
  });

  it("skips with the none-found detail when the model finds no stockists", async () => {
    createClient.mockReturnValue({
      chat: vi.fn().mockResolvedValue({
        response: { ok: true },
        content: JSON.stringify({ stockists: [] }),
      }),
    });

    const output = await runStockistsPhase({
      brand,
      phases,
      target,
      deps: {
        loadPersistedScrapeText: scrape("我們的門市在台北信義區，歡迎參觀。"),
      },
    });

    expect(output.phaseResult.status).toBe("skipped");
    expect(output.phaseResult.detail).toBe(STOCKISTS_NONE_FOUND_SKIP_DETAIL);
    expect(output.patch).toEqual({});
  });

  it("skips with the no-evidence detail when no scrape was persisted", async () => {
    const output = await runStockistsPhase({
      brand,
      phases,
      target,
      deps: { loadPersistedScrapeText: scrape(null) },
    });

    expect(output.phaseResult.status).toBe("skipped");
    expect(output.phaseResult.detail).toBe(STOCKISTS_NO_EVIDENCE_SKIP_DETAIL);
    expect(output.patch).toEqual({});
    expect(createClient).not.toHaveBeenCalled();
  });

  // DEV-1943: the read-time guard needs the brand's owned site hosts.
  it("reads persisted scrape text against the brand's owned site hosts", async () => {
    const load = scrape(null);
    await runStockistsPhase({
      brand: { ...brand, website_url: "https://www.island.tw" },
      phases,
      target,
      deps: { loadPersistedScrapeText: load },
    });

    expect(load).toHaveBeenCalledWith(target, new Set(["island.tw"]));
  });

  it("skips with the no-signal detail when the scrape names no stockist", async () => {
    const output = await runStockistsPhase({
      brand,
      phases,
      target,
      deps: {
        loadPersistedScrapeText: scrape("A paragraph about the founders."),
      },
    });

    expect(output.phaseResult.detail).toBe(STOCKISTS_NO_SIGNAL_SKIP_DETAIL);
    expect(output.patch).toEqual({});
    expect(createClient).not.toHaveBeenCalled();
  });
});
