import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arbitrateBrandName, type NameArbiterItem } from "../name-arbiter";

const promptMeta = { name: "name-arbiter", version: 2, source: "langfuse" as const };
vi.mock("@/lib/langfuse/prompt", () => ({
  fetchLangfusePrompt: vi.fn((_n: string) => Promise.resolve("mock-prompt")),
  fetchLangfusePromptWithMeta: vi.fn((_n: string) =>
    Promise.resolve({ text: "mock-prompt", prompt: promptMeta }),
  ),
}));

const mockFetch = vi.fn();

function modelAnswer(content: string) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
    headers: new Headers(),
  };
}

function verdicts(
  ...results: Array<{ slug: string; chosen: string; confidence: string; reason: string }>
) {
  return modelAnswer(JSON.stringify({ results }));
}

describe("arbitrateBrandName", () => {
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

  const xiaoZhu: NameArbiterItem = {
    slug: "xiao-zhu-dessert",
    storedName: "小朱甜點",
    candidates: [
      { source: "stored", value: "小朱甜點" },
      { source: "scraped", value: "首頁 - 小朱甜點" },
    ],
    snippets: ["小朱甜點 官方網站"],
  };
  const unigaze: NameArbiterItem = {
    slug: "unigaze",
    storedName: "UNIGAZE",
    candidates: [
      { source: "stored", value: "UNIGAZE" },
      { source: "detected", value: "UNIGAZE 慢火金工創作室" },
    ],
  };

  it("returns the verdict from a one-entry results array in one call", async () => {
    mockFetch.mockResolvedValueOnce(
      verdicts({
        slug: "unigaze",
        chosen: "UNIGAZE 慢火金工創作室",
        confidence: "high",
        reason: "中文尾段是正式名稱",
      }),
    );

    const outcome = await arbitrateBrandName(unigaze);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(outcome.value).toEqual({
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

  it("renders only its own brand into the user message", async () => {
    mockFetch.mockResolvedValueOnce(
      verdicts({
        slug: "xiao-zhu-dessert",
        chosen: "小朱甜點",
        confidence: "high",
        reason: "去除頁面標題外框",
      }),
    );

    await arbitrateBrandName(xiaoZhu);

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const user = body.messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("1. [xiao-zhu-dessert]");
    expect(user).toContain("搜尋摘要：小朱甜點 官方網站");
    expect(user).not.toContain("2. [");
  });

  it("rejects a model-invented value that is not a supplied candidate", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(
      verdicts({
        slug: "xiao-zhu-dessert",
        chosen: "小朱甜點工作室",
        confidence: "high",
        reason: "模型補寫",
      }),
    );

    const outcome = await arbitrateBrandName(xiaoZhu);

    expect(outcome.value).toBeNull();
    expect(outcome.calls).toEqual({ attempted: 1, providerFailed: 0 });
  });

  it("reports a content failure on malformed content", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(modelAnswer("not json at all"));

    const outcome = await arbitrateBrandName(xiaoZhu);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(outcome.value).toBeNull();
    expect(outcome.calls).toEqual({ attempted: 1, providerFailed: 0 });
  });

  it("reports a provider failure on a non-2xx answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      clone: () => ({
        json: async () => ({ error: { code: "insufficient_quota" } }),
      }),
      json: async () => ({ error: { code: "insufficient_quota" } }),
      headers: new Headers(),
    });

    const outcome = await arbitrateBrandName(xiaoZhu);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(outcome.value).toBeNull();
    expect(outcome.calls).toEqual({ attempted: 1, providerFailed: 1 });
  });

  it("issues no call without an API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const outcome = await arbitrateBrandName(xiaoZhu);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      value: null,
      calls: { attempted: 0, providerFailed: 0 },
    });
  });

  it("audit context carries prompt meta from fetchLangfusePromptWithMeta", async () => {
    mockFetch.mockResolvedValueOnce(
      verdicts({
        slug: "xiao-zhu-dessert",
        chosen: "小朱甜點",
        confidence: "high",
        reason: "test",
      }),
    );

    await arbitrateBrandName(xiaoZhu);

    const { fetchLangfusePromptWithMeta } = await import("@/lib/langfuse/prompt");
    expect(fetchLangfusePromptWithMeta).toHaveBeenCalledWith("name-arbiter");
  });
});
