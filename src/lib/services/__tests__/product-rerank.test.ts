import { describe, expect, it, vi } from "vitest";
import { rerankProducts, buildRerankDocument } from "../product-rerank";
import type { CatalogProduct } from "../curated-products-catalog";
import type { RerankDocumentInput } from "../product-rerank";

function makeCandidates(ids: string[]) {
  return ids.map((id) => ({ id, document: `Product ${id}` }));
}

describe("rerankProducts", () => {
  it("returns candidates in the model's ranking order", async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      content: JSON.stringify({ ranking: ["c", "a", "b"] }),
    });

    const candidates = makeCandidates(["a", "b", "c"]);
    const result = await rerankProducts("test query", candidates, { chat });

    expect(result.map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("falls back to input order on schema failure", async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      content: "not valid json at all",
    });

    const candidates = makeCandidates(["a", "b", "c"]);
    const result = await rerankProducts("test query", candidates, { chat });

    expect(result.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to input order when ranking contains unknown ids", async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      content: JSON.stringify({ ranking: ["z", "y"] }),
    });

    const candidates = makeCandidates(["a", "b"]);
    const result = await rerankProducts("test query", candidates, { chat });

    // None of the ranked ids match, so fallback to input order
    expect(result.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("falls back to input order when chat returns ok: false", async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: false,
      content: null,
    });

    const candidates = makeCandidates(["a", "b"]);
    const result = await rerankProducts("test query", candidates, { chat });

    expect(result.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("appends candidates not mentioned in the ranking at the end", async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      content: JSON.stringify({ ranking: ["b"] }),
    });

    const candidates = makeCandidates(["a", "b", "c"]);
    const result = await rerankProducts("test query", candidates, { chat });

    // "b" first (from ranking), then "a" and "c" in original order
    expect(result.map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
});

// ---------------------------------------------------------------------------
// buildRerankDocument
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "prod-1",
    key: "tea-set",
    nameZh: "經典茶具組",
    nameEn: "Classic Tea Set",
    category: "lifestyle",
    subcategory: "tea",
    material: [],
    createdAt: "2026-01-01",
    imageUrl: null,
    officialUrl: null,
    brandSlug: "goodglas",
    brandName: "GOODGLAS",
    productDescriptionZh: "精緻雙層玻璃杯，適合日常品茶使用。",
    productDescriptionEn: null,
    brand: {
      slug: "goodglas",
      purchaseWebsite: null,
      purchasePinkoi: null,
      purchaseShopee: null,
      purchaseMyship: null,
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
    },
    ...overrides,
  };
}

describe("buildRerankDocument", () => {
  it("includes all fields", () => {
    const doc = buildRerankDocument(makeProduct());

    expect(doc).toContain("GOODGLAS");
    expect(doc).toContain("經典茶具組");
    expect(doc).toContain("Classic Tea Set");
    expect(doc).toContain("lifestyle");
    expect(doc).toContain("tea");
    expect(doc).toContain("精緻雙層玻璃杯，適合日常品茶使用。");
  });

  it("truncates description at 500 chars with ellipsis", () => {
    const longDesc = "茶".repeat(600);
    const doc = buildRerankDocument(
      makeProduct({ productDescriptionZh: longDesc }),
    );

    // 500 chars + ellipsis
    expect(doc).toContain("茶".repeat(500) + "…");
    expect(doc).not.toContain("茶".repeat(501));
  });

  it("handles null nameEn by omitting the parenthetical", () => {
    const doc = buildRerankDocument(makeProduct({ nameEn: null }));

    expect(doc).toContain("經典茶具組");
    expect(doc).not.toContain("(");
    expect(doc).not.toContain(")");
  });

  it("handles empty description", () => {
    const doc = buildRerankDocument(
      makeProduct({ productDescriptionZh: "" }),
    );

    expect(doc).toContain("GOODGLAS");
    expect(doc).toContain("經典茶具組");
    expect(typeof doc).toBe("string");
    expect(doc.length).toBeGreaterThan(0);
  });

  it("handles object with no optional fields (narrow dep type)", () => {
    const narrow: RerankDocumentInput = {};
    const result = buildRerankDocument(narrow);
    expect(result).toBe(" —  [/] ");
  });
});
