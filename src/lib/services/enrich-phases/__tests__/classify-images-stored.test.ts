import { describe, expect, it } from "vitest";
import {
  classifyStoredImages,
  type BrandImageForClassification,
} from "../classify-images";
import { brandTarget } from "../../_shared/enrichment-target";
import type { OpenAIChatResult } from "../../openai-client";

/**
 * `classifyStoredImages` is the read-and-judge half of the classify phase, split
 * out so the acquisition agent can classify the images it just downloaded
 * without re-entering the phase runner.
 *
 * The property these tests exist for is the SPLIT itself: the function returns
 * planned row writes and performs none of them. A fake client whose `update()`
 * throws is what keeps that honest — a future edit that writes inline fails here
 * rather than in production, where the writes it would perform are the ones
 * DEV-1255 destroyed 18 live images with.
 */

type Filter = [string, ...unknown[]];

type RecordedSelect = { table: string; columns: string; filters: Filter[] };

function fakeSupabase(rows: BrandImageForClassification[]) {
  const selects: RecordedSelect[] = [];
  let updateCount = 0;

  function selectQuery(record: RecordedSelect) {
    const query = {
      eq(column: string, value: string) {
        record.filters.push(["eq", column, value]);
        return query;
      },
      neq(column: string, value: string) {
        record.filters.push(["neq", column, value]);
        return query;
      },
      in(column: string, values: string[]) {
        record.filters.push(["in", column, values]);
        return query;
      },
      is(column: string, value: null) {
        record.filters.push(["is", column, value]);
        return query;
      },
      order(column: string, options: { ascending: boolean }) {
        record.filters.push(["order", column, options]);
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return query;
  }

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const record: RecordedSelect = { table, columns, filters: [] };
          selects.push(record);
          return selectQuery(record);
        },
        update() {
          updateCount += 1;
          throw new Error(
            "classifyStoredImages must not write rows; it returns a write plan",
          );
        },
      };
    },
  };

  return {
    client,
    selects,
    get updateCount() {
      return updateCount;
    },
  };
}

function chatResult(content: string): OpenAIChatResult {
  return {
    response: new Response(null),
    data: null,
    content,
    ok: true,
    status: 200,
    errorBody: null,
    finishReason: "stop",
    refusal: null,
    toolCalls: null,
  };
}

function fakeChatClient(content: string) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      async chat(input: unknown): Promise<OpenAIChatResult> {
        calls.push(input);
        return chatResult(content);
      },
    },
  };
}

function image(
  id: string,
  overrides: Partial<BrandImageForClassification> = {},
): BrandImageForClassification {
  return {
    id,
    url: `https://cdn.example/${id}.webp`,
    source: "scrape",
    status: "active",
    tags: null,
    score: null,
    sort_order: 0,
    storage_path: `brands/${id}.webp`,
    width: 1200,
    height: 900,
    ...overrides,
  };
}

const brand = {
  id: "5f0d1a2b-8c3d-4e5f-9a0b-1c2d3e4f5a6b",
  slug: "shan-hai-tea",
  name: "Shan Hai",
  category: "food-drink",
  purchase_website: "https://shanhai.example",
};

const KEEP_AND_REJECT = JSON.stringify({
  classifications: [
    {
      id: "1",
      disposition: "keep",
      tag: "product",
      reasons: [],
      score: 82,
      caption: "A ceramic teapot on a linen cloth",
    },
    {
      id: "2",
      disposition: "reject",
      tag: null,
      reasons: ["irrelevant"],
      score: 21,
      caption: null,
    },
  ],
});

describe("classifyStoredImages", () => {
  it("returns classifications and a write plan without writing any row", async () => {
    const supabase = fakeSupabase([image("img-a"), image("img-b")]);
    const chat = fakeChatClient(KEEP_AND_REJECT);

    const result = await classifyStoredImages({
      brand,
      target: brandTarget(brand.id),
      supabase: supabase.client,
      client: chat.client,
      loadImage: async () => "data:image/webp;base64,AAAA",
    });

    expect(result.skipped).toBeNull();
    expect(result.classified.map((c) => c.id)).toEqual(["img-a", "img-b"]);
    expect(result.writes.map((w) => w.id)).toEqual(["img-a", "img-b"]);
    expect(result.rejectedCount).toBe(1);
    expect(result.unjudgedCount).toBe(0);
    expect(result.attemptedBatches).toBe(1);
    expect(result.failures).toEqual([]);
    expect(supabase.updateCount).toBe(0);

    // The plan carries the row the caller would apply, not a mutated row.
    expect(result.writes[0].row).toMatchObject({
      tags: ["product"],
      status: "active",
      score: 82,
    });
    expect(result.writes[1].row).toMatchObject({
      tags: null,
      status: "rejected",
      rejection_reasons: ["irrelevant"],
    });
  });

  it("reads nothing on a dry run", async () => {
    const supabase = fakeSupabase([image("img-a")]);
    const chat = fakeChatClient(KEEP_AND_REJECT);
    let loads = 0;

    const result = await classifyStoredImages({
      brand,
      target: brandTarget(brand.id),
      supabase: supabase.client,
      client: chat.client,
      dryRun: true,
      loadImage: async () => {
        loads += 1;
        return "data:image/webp;base64,AAAA";
      },
    });

    expect(result.skipped).toBe("dry run");
    expect(result.classified).toEqual([]);
    expect(result.writes).toEqual([]);
    expect(supabase.selects).toEqual([]);
    expect(chat.calls).toEqual([]);
    expect(loads).toBe(0);
  });

  it("restricts the candidate rows to onlyImageIds", async () => {
    const supabase = fakeSupabase([image("img-a")]);
    const chat = fakeChatClient(KEEP_AND_REJECT);

    await classifyStoredImages({
      brand,
      target: brandTarget(brand.id),
      supabase: supabase.client,
      client: chat.client,
      onlyImageIds: ["img-a"],
      loadImage: async () => "data:image/webp;base64,AAAA",
    });

    expect(supabase.selects[0].table).toBe("brand_images");
    expect(supabase.selects[0].filters).toContainEqual([
      "in",
      "id",
      ["img-a"],
    ]);
  });

  it("skips without an LLM call when nothing is unclassified", async () => {
    const supabase = fakeSupabase([]);
    const chat = fakeChatClient(KEEP_AND_REJECT);

    const result = await classifyStoredImages({
      brand,
      target: brandTarget(brand.id),
      supabase: supabase.client,
      client: chat.client,
      loadImage: async () => "data:image/webp;base64,AAAA",
    });

    expect(result.skipped).toBe("no unclassified images");
    expect(chat.calls).toEqual([]);
    expect(result.candidateCount).toBe(0);
  });

  it("plans no write for an image whose bytes never loaded", async () => {
    const supabase = fakeSupabase([image("img-a"), image("img-b")]);
    const chat = fakeChatClient(KEEP_AND_REJECT);

    const result = await classifyStoredImages({
      brand,
      target: brandTarget(brand.id),
      supabase: supabase.client,
      client: chat.client,
      loadImage: async (candidate) =>
        candidate.id === "img-a" ? "data:image/webp;base64,AAAA" : null,
    });

    expect(result.unavailableCount).toBe(1);
    expect(result.writes.map((w) => w.id)).toEqual(["img-a"]);
  });

  it("classify_batches_run_two_at_a_time_and_write_in_chunk_order", async () => {
    // 30 images = 3 chunks of 10. The fake classifier tracks concurrency.
    const images = Array.from({ length: 30 }, (_, i) => image(`img-${i}`));
    const supabase = fakeSupabase(images);

    let inflight = 0;
    let maxInflight = 0;
    const chunkOrder: number[] = [];

    // A classifier that records concurrency and order
    const classifierClient = {
      async chat(input: unknown): Promise<OpenAIChatResult> {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        // yield to let another chunk start if allowed by concurrency
        await new Promise((resolve) => setTimeout(resolve, 10));
        inflight -= 1;

        // Parse out the image count from the input to determine which chunk
        const req = input as { user: string; images: string[] };
        chunkOrder.push(req.images.length);

        // Return a valid classification for every image in the chunk
        const count = req.images.length;
        const classifications = Array.from({ length: count }, (_, i) => ({
          id: String(i + 1),
          disposition: "keep",
          tag: "product",
          reasons: [],
          score: 82,
          caption: null,
        }));
        return chatResult(JSON.stringify({ classifications }));
      },
    };

    const result = await classifyStoredImages({
      brand,
      target: brandTarget(brand.id),
      supabase: supabase.client,
      client: classifierClient,
      loadImage: async () => "data:image/webp;base64,AAAA",
    });

    // At most 2 chunks in flight at a time
    expect(maxInflight).toBeLessThanOrEqual(2);
    // All 3 chunks were processed
    expect(chunkOrder).toHaveLength(3);
    // planChunkImageWrites results are applied in chunk order
    expect(result.writes).toHaveLength(30);
    // First chunk's writes come first
    expect(result.writes[0]!.id).toBe("img-0");
    expect(result.writes[10]!.id).toBe("img-10");
    expect(result.writes[20]!.id).toBe("img-20");
    // attemptedBatches still counts all 3
    expect(result.attemptedBatches).toBe(3);
    expect(result.failures).toEqual([]);
  });
});
