import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  arbitrateSiteIdentity,
  siteIdentityKey,
  type SiteIdentityItem,
} from "../site-identity-arbiter";

const mockFetch = vi.fn();

describe("arbitrateSiteIdentity", () => {
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

  const items: SiteIdentityItem[] = [
    {
      slug: "xiao-zhu-dessert",
      brandName: "小朱甜點",
      categorySlug: "甜點",
      subjectUrl: "https://xiao-zhu.example",
      subjectKind: "website",
      pageTitle: "小朱甜點｜官方網站",
    },
    {
      slug: "unigaze",
      brandName: "UNIGAZE",
      categorySlug: "金工",
      subjectUrl: "https://example.com/unigaze",
      subjectKind: "source-page",
      pageDescription: "UNIGAZE 慢火金工創作室",
    },
  ];

  const response = (content: unknown) => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
  });

  it("parses a wrapped results array", async () => {
    mockFetch.mockResolvedValueOnce(
      response({
        results: [
          {
            slug: "xiao-zhu-dessert",
            owned: true,
            confidence: "high",
            reason: "品牌官方網站",
          },
          {
            slug: "unigaze",
            owned: false,
            confidence: "medium",
            reason: "媒體文章",
          },
        ],
      }),
    );

    const outcome = await arbitrateSiteIdentity(items);

    expect(outcome.results.size).toBe(2);
    expect(
      outcome.results.get(siteIdentityKey(items[0].slug, items[0].subjectUrl)),
    ).toEqual({
      slug: "xiao-zhu-dessert",
      owned: true,
      confidence: "high",
      reason: "品牌官方網站",
    });
    expect(
      outcome.results.get(siteIdentityKey(items[1].slug, items[1].subjectUrl)),
    ).toEqual({
      slug: "unigaze",
      owned: false,
      confidence: "medium",
      reason: "媒體文章",
    });
  });

  it("rejects a malformed verdict", async () => {
    mockFetch.mockResolvedValueOnce(
      response({
        results: [
          {
            slug: "xiao-zhu-dessert",
            owned: true,
            confidence: "certain",
            reason: "不接受未知信心值",
          },
          {
            slug: "unigaze",
            owned: false,
            confidence: "low",
            reason: "資訊不足",
          },
        ],
      }),
    );

    const outcome = await arbitrateSiteIdentity(items);

    expect(outcome.results.size).toBe(1);
    expect(
      outcome.results.get(siteIdentityKey(items[1].slug, items[1].subjectUrl)),
    ).toMatchObject({ owned: false, confidence: "low" });
  });

  it("joins on slug + subjectUrl", async () => {
    const duplicateItems: SiteIdentityItem[] = [
      {
        ...items[0],
        subjectKind: "website",
        subjectUrl: "https://xiao-zhu.example",
      },
      {
        ...items[0],
        subjectKind: "source-page",
        subjectUrl: "https://example.com/xiao-zhu",
      },
    ];
    mockFetch.mockResolvedValueOnce(
      response({
        results: [
          {
            slug: "xiao-zhu-dessert",
            subjectUrl: "https://xiao-zhu.example",
            owned: true,
            confidence: "high",
            reason: "官方網域",
          },
          {
            slug: "xiao-zhu-dessert",
            subjectUrl: "https://example.com/xiao-zhu",
            owned: false,
            confidence: "high",
            reason: "外部文章",
          },
        ],
      }),
    );

    const outcome = await arbitrateSiteIdentity(duplicateItems);

    expect(
      outcome.results.get(
        siteIdentityKey("xiao-zhu-dessert", "https://xiao-zhu.example"),
      )?.owned,
    ).toBe(true);
    expect(
      outcome.results.get(
        siteIdentityKey("xiao-zhu-dessert", "https://example.com/xiao-zhu"),
      )?.owned,
    ).toBe(false);
  });

  // There is no positional fallback: response order is not evidence, and using
  // it landed an `owned` verdict on the wrong subject URL. Dropping releases the
  // subject, which is the safe direction.
  it("drops an entry that cannot be joined", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // Also answers the per-item fan-out, which re-asks for the dropped items.
    mockFetch.mockResolvedValue(
      response({
        results: [
          { owned: true, confidence: "high", reason: "官方網域" },
          { owned: false, confidence: "low", reason: "資訊不足" },
        ],
      }),
    );

    const outcome = await arbitrateSiteIdentity(items);

    expect(outcome.results.size).toBe(0);
    error.mockRestore();
  });

  it("provider failure does not fan out", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      clone: () => ({
        json: async () => ({ error: { code: "insufficient_quota" } }),
      }),
      json: async () => ({ error: { code: "insufficient_quota" } }),
      headers: new Headers(),
    });

    const outcome = await arbitrateSiteIdentity(items);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(outcome.calls).toEqual({ attempted: 1, providerFailed: 1 });
    expect(error).toHaveBeenCalled();
  });

  it("content failure fans out per item", async () => {
    mockFetch
      .mockResolvedValueOnce(
        response("not json at all"),
      )
      .mockResolvedValueOnce(
        response({
          results: [
            {
              slug: "xiao-zhu-dessert",
              owned: true,
              confidence: "high",
              reason: "官方網域",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          results: [
            {
              slug: "unigaze",
              owned: false,
              confidence: "medium",
              reason: "外部頁面",
            },
          ],
        }),
      );

    const outcome = await arbitrateSiteIdentity(items);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(outcome.results.size).toBe(2);
    expect(
      outcome.results.get(siteIdentityKey(items[0].slug, items[0].subjectUrl))
        ?.owned,
    ).toBe(true);
    expect(
      outcome.results.get(siteIdentityKey(items[1].slug, items[1].subjectUrl))
        ?.owned,
    ).toBe(false);
  });
});
