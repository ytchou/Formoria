import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLM_BATCH_CHUNK_SIZE } from "@/lib/constants/llm-models";
import { arbitrateBrandNames, type NameArbiterItem } from "../name-arbiter";

const mockFetch = vi.fn();

describe("arbitrateBrandNames", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const items: NameArbiterItem[] = [
    {
      slug: "xiao-zhu-dessert",
      storedName: "小朱甜點",
      candidates: [
        { source: "stored", value: "小朱甜點" },
        { source: "scraped", value: "首頁 - 小朱甜點" },
      ],
      snippets: ["小朱甜點 官方網站"],
    },
    {
      slug: "unigaze",
      storedName: "UNIGAZE",
      candidates: [
        { source: "stored", value: "UNIGAZE" },
        { source: "detected", value: "UNIGAZE 慢火金工創作室" },
      ],
    },
  ];

  it("returns verdicts keyed by slug", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  {
                    slug: "xiao-zhu-dessert",
                    chosen: "小朱甜點",
                    confidence: "high",
                    reason: "去除頁面標題外框",
                  },
                  {
                    slug: "unigaze",
                    chosen: "UNIGAZE 慢火金工創作室",
                    confidence: "high",
                    reason: "中文尾段是正式名稱",
                  },
                ],
              }),
            },
          },
        ],
      }),
    });

    const outcome = await arbitrateBrandNames(items);

    expect(outcome.results.get("xiao-zhu-dessert")).toEqual({
      chosen: "小朱甜點",
      confidence: "high",
      reason: "去除頁面標題外框",
    });
    expect(outcome.results.get("unigaze")).toEqual({
      chosen: "UNIGAZE 慢火金工創作室",
      confidence: "high",
      reason: "中文尾段是正式名稱",
    });
    expect(outcome.calls).toEqual({ attempted: 1, providerFailed: 0 });

    // json_object mode forbids a top-level array, so the wrapped object is the
    // contract and the request must pin it with a json_schema response_format.
    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.response_format.type).toBe("json_schema");
    expect(
      body.response_format.json_schema.schema.properties.results.type,
    ).toBe("array");
  });

  it("tolerates a bare top-level array in one call with no fan-out", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  slug: "xiao-zhu-dessert",
                  chosen: "小朱甜點",
                  confidence: "high",
                  reason: "去除頁面標題外框",
                },
                {
                  slug: "unigaze",
                  chosen: "UNIGAZE 慢火金工創作室",
                  confidence: "high",
                  reason: "中文尾段是正式名稱",
                },
              ]),
            },
          },
        ],
      }),
    });

    const outcome = await arbitrateBrandNames(items);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(outcome.results.size).toBe(2);
    expect(outcome.calls).toEqual({ attempted: 1, providerFailed: 0 });
  });

  it("accepts a bare single object as a one-element array", async () => {
    // The 2026-08-03 DEV-1321 eval: a 20-item prompt came back as one object
    // for the first item, the chunk was scored malformed, and every case fell
    // through to per-item fan-out (28 calls for 26 cases).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                slug: "unigaze",
                chosen: "UNIGAZE 慢火金工創作室",
                confidence: "high",
                reason: "中文尾段是正式名稱",
              }),
            },
          },
        ],
      }),
    });

    const unigaze = items.filter((item) => item.slug === "unigaze");
    const outcome = await arbitrateBrandNames(unigaze);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(outcome.results.size).toBe(1);
    expect(outcome.results.get("unigaze")).toEqual({
      chosen: "UNIGAZE 慢火金工創作室",
      confidence: "high",
      reason: "中文尾段是正式名稱",
    });
    expect(outcome.calls).toEqual({ attempted: 1, providerFailed: 0 });
  });

  it("chunks across the shared batch boundary", async () => {
    const largeItems: NameArbiterItem[] = Array.from(
      { length: 25 },
      (_, index) => ({
        slug: `brand-${index}`,
        storedName: `Brand ${index}`,
        candidates: [
          { source: "stored" as const, value: `Brand ${index}` },
          { source: "detected" as const, value: `Brand ${index} Studio` },
        ],
      }),
    );

    const makeResponse = (start: number, count: number) => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: Array.from({ length: count }, (_, offset) => ({
                  slug: `brand-${start + offset}`,
                  chosen: `Brand ${start + offset}`,
                  confidence: "high",
                  reason: "保留品牌名稱",
                })),
              }),
            },
          },
        ],
      }),
    });

    mockFetch
      .mockResolvedValueOnce(makeResponse(0, LLM_BATCH_CHUNK_SIZE))
      .mockResolvedValueOnce(makeResponse(LLM_BATCH_CHUNK_SIZE, 5));

    const outcome = await arbitrateBrandNames(largeItems);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(outcome.results.size).toBe(25);
    expect(outcome.calls).toEqual({ attempted: 2, providerFailed: 0 });
  });

  it("uses positional fallback when a response slug is missing or unknown", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  {
                    chosen: "小朱甜點",
                    confidence: "high",
                    reason: "保留正式名稱",
                  },
                  {
                    slug: "not-a-requested-slug",
                    chosen: "UNIGAZE 慢火金工創作室",
                    confidence: "medium",
                    reason: "候選較完整",
                  },
                ],
              }),
            },
          },
        ],
      }),
    });

    const outcome = await arbitrateBrandNames(items);

    expect(outcome.results.get("xiao-zhu-dessert")?.chosen).toBe("小朱甜點");
    expect(outcome.results.get("unigaze")?.chosen).toBe(
      "UNIGAZE 慢火金工創作室",
    );
  });

  it("fans out to single-item calls after malformed batch content", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "not json at all" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chosen: "小朱甜點",
                  confidence: "high",
                  reason: "保留正式名稱",
                }),
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chosen: "UNIGAZE 慢火金工創作室",
                  confidence: "high",
                  reason: "保留完整名稱",
                }),
              },
            },
          ],
        }),
      });

    const outcome = await arbitrateBrandNames(items);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(outcome.results.size).toBe(2);
    expect(outcome.calls).toEqual({ attempted: 3, providerFailed: 0 });
  });

  it("reports provider failure without per-item fan-out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // A spent account answers 429 to the batch call and would answer 429 to
    // every single-brand retry too. One call, not one plus twenty.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      clone: () => ({
        json: async () => ({ error: { code: "insufficient_quota" } }),
      }),
      json: async () => ({ error: { code: "insufficient_quota" } }),
      headers: new Headers(),
    });

    const outcome = await arbitrateBrandNames(items);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(outcome.results.size).toBe(0);
    expect(outcome.calls).toEqual({ attempted: 1, providerFailed: 1 });
  });
});
