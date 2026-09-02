import { describe, expect, it, vi } from "vitest";
import {
  chunkInputs,
  planEmbeddingRefresh,
  refreshProductEmbeddings,
} from "../product-embeddings";
import { EMBEDDING_BATCH_SIZE } from "@/lib/constants/llm-models";

describe("planEmbeddingRefresh", () => {
  it("selects rows whose hash differs or is missing and orphans to delete", () => {
    const documents = [
      { product_id: "a", source_hash: "h1" },
      { product_id: "b", source_hash: "h2" },
      { product_id: "c", source_hash: "h3" },
    ];
    const existing = [
      { product_id: "a", source_hash: "h1" }, // up to date
      { product_id: "b", source_hash: "OLD" }, // stale
      { product_id: "d", source_hash: "h4" }, // orphan
    ];

    const plan = planEmbeddingRefresh(documents, existing);
    expect(plan.stale.map((d) => d.product_id).sort()).toEqual(["b", "c"]);
    expect(plan.orphanIds).toEqual(["d"]);
  });
});

describe("chunkInputs", () => {
  it("splits into EMBEDDING_BATCH_SIZE groups preserving order", () => {
    const items = Array.from({ length: EMBEDDING_BATCH_SIZE + 5 }, (_, i) => ({
      product_id: `p${i}`,
      source_hash: `h${i}`,
      content: `text ${i}`,
    }));
    const chunks = chunkInputs(items);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(EMBEDDING_BATCH_SIZE);
    expect(chunks[1]).toHaveLength(5);
    expect(chunks[0]![0]!.product_id).toBe("p0");
    expect(chunks[1]![0]!.product_id).toBe(`p${EMBEDDING_BATCH_SIZE}`);
  });
});

describe("refreshProductEmbeddings", () => {
  const makeDoc = (id: string, hash: string) => ({
    product_id: id,
    source_hash: hash,
    content: `text for ${id}`,
  });

  it("dryRun embeds nothing and reports counts", async () => {
    const embedder = vi.fn();
    const writer = vi.fn();
    const reader = vi.fn().mockResolvedValue({
      documents: [makeDoc("a", "h1"), makeDoc("b", "h2")],
      existing: [],
    });

    const result = await refreshProductEmbeddings({
      dryRun: true,
      reader,
      writer,
      embedder,
    });

    expect(embedder).not.toHaveBeenCalled();
    expect(writer).not.toHaveBeenCalled();
    expect(result.stale).toBe(2);
    expect(result.embedded).toBe(0);
  });

  it("upserts vectors with model and source_hash and deletes orphans", async () => {
    const upsertedRows: unknown[] = [];
    const deletedIds: string[] = [];
    const embedder = vi.fn().mockResolvedValue({
      ok: true,
      vectors: [[0.1], [0.2]],
      usage: { prompt_tokens: 10 },
      model: "text-embedding-3-small",
    });
    const writer = vi.fn().mockImplementation(async ({ upserts, deletes }) => {
      upsertedRows.push(...upserts);
      deletedIds.push(...deletes);
    });
    const reader = vi.fn().mockResolvedValue({
      documents: [makeDoc("a", "h1"), makeDoc("b", "h2")],
      existing: [{ product_id: "orphan", source_hash: "old" }],
    });

    const result = await refreshProductEmbeddings({
      dryRun: false,
      reader,
      writer,
      embedder,
    });

    expect(result.embedded).toBe(2);
    expect(result.deleted).toBe(1);
    expect(upsertedRows).toHaveLength(2);
    expect(deletedIds).toEqual(["orphan"]);

    const first = upsertedRows[0] as Record<string, unknown>;
    expect(first).toHaveProperty("product_id", "a");
    expect(first).toHaveProperty("source_hash", "h1");
    expect(first).toHaveProperty("model", "text-embedding-3-small");
  });

  it("stops after the first failed batch and reports it", async () => {
    const embedder = vi
      .fn()
      .mockRejectedValueOnce(new Error("API down"))
      .mockResolvedValueOnce({
        ok: true,
        vectors: [[0.1]],
        usage: { prompt_tokens: 5 },
        model: "text-embedding-3-small",
      });
    const writer = vi.fn();
    const docs = Array.from({ length: EMBEDDING_BATCH_SIZE + 1 }, (_, i) =>
      makeDoc(`p${i}`, `h${i}`),
    );
    const reader = vi.fn().mockResolvedValue({
      documents: docs,
      existing: [],
    });

    const result = await refreshProductEmbeddings({
      dryRun: false,
      reader,
      writer,
      embedder,
    });

    expect(result.failedBatches.length).toBe(1);
    expect(result.failedBatches[0]).toContain("API down");
    // Should not attempt the second batch
    expect(embedder).toHaveBeenCalledTimes(1);
  });
});
