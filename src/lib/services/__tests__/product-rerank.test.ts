import { describe, expect, it, vi } from "vitest";
import { rerankProducts } from "../product-rerank";

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
