import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDetectResult, runDetectPhase } from "../detect";
import {
  MAX_PROBE_URLS,
  renderDetectUserMessage,
  type DetectItem,
  type DetectResult,
} from "../../category-classifier";
import type { BatchPhaseContext, EnrichBrand, EnrichPhase } from "../types";

/**
 * Only the provider-client factory is stubbed. `createProfiledOpenAIClient` is
 * the adapter in front of OpenAI (allowlisted in `check:test-boundaries`), so
 * `detectBrand`, the message renderer, the evidence policy and the response
 * parser all run for real. Assertions read the outgoing chat request — the
 * exact text the model would see — and the client context (target, jobId).
 * Same seam as `products.test.ts`.
 */
const createClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/llm-audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/llm-audit")>()),
  createProfiledOpenAIClient: createClient,
}));

vi.mock("@/lib/langfuse/prompt", () => ({
  fetchLangfusePrompt: vi.fn((_name: string) => Promise.resolve("mock-prompt")),
  fetchLangfusePromptWithMeta: vi.fn((name: string) =>
    Promise.resolve({
      text: "mock-prompt",
      prompt: { name, version: 1, source: "langfuse" as const },
    }),
  ),
}));

type ChatInput = { system: string; user: string };
type ChatReply = {
  response: { ok: boolean; status: number };
  data: unknown;
  content: string | null;
};
const chat = vi.fn<(input: ChatInput) => Promise<ChatReply>>();

const brand: EnrichBrand = {
  id: "brand-1",
  slug: "test-brand",
  name: "Test Brand",
  description: "Original description",
  category: null,
  purchase_website: "https://test.example",
};

const brandDetect: DetectResult = {
  isNonBrand: false,
  nonBrandReason: null,
  brandName: null,
  slug: "test-brand",
  slugGenerated: "better-brand",
  categorySlug: "skincare",
  confidence: "high",
};

const secondBrand: EnrichBrand = {
  ...brand,
  id: "brand-2",
  slug: "second-brand",
  name: "Second Brand",
};

/** The DetectItem `runDetectPhase` builds for `brand` with no evidence. */
const baseItem: DetectItem = {
  slug: "test-brand",
  name: "Test Brand",
  description: "Original description",
  website: "https://test.example",
  submittedWebsite: null,
  results: [],
};

/** The provider answered with no content: a healthy call, no verdict. */
const healthyEmpty: ChatReply = {
  response: { ok: true, status: 200 },
  data: {},
  content: null,
};
/** Non-2xx: the call never reached the model. */
const providerDown: ChatReply = {
  response: { ok: false, status: 503 },
  data: null,
  content: null,
};
/** A valid high-confidence brand verdict, in the model's wire format. */
const brandVerdict: ChatReply = {
  response: { ok: true, status: 200 },
  data: {},
  content: JSON.stringify({
    reasoning: "A product brand",
    isNonBrand: false,
    nonBrandReason: null,
    brand_name: null,
    slug_generated: "better-brand",
    confidence: "high",
  }),
};

function sentMessages(): string[] {
  return chat.mock.calls.map(([input]) => input.user);
}

function firstMessage(): string {
  const [message] = sentMessages();
  expect(message).toBeDefined();
  return message!;
}

function linesWith(message: string, label: string): string[] {
  return message.split("\n").filter((line) => line.startsWith(`${label}：`));
}

function ctx(overrides: Partial<BatchPhaseContext> = {}): BatchPhaseContext {
  return {
    chunk: [brand],
    chunkBrandNames: ["Test Brand"],
    phases: ["detect"] as EnrichPhase[],
    dryRun: true,
    supabase: null as unknown as BatchPhaseContext["supabase"],
    ...overrides,
  };
}

beforeEach(() => {
  chat.mockReset();
  createClient.mockReset();
  createClient.mockReturnValue({ chat });
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  // Empty and failed answers log to console.error by design.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runDetectPhase", () => {
  it("returns skipped when no detect phases requested", async () => {
    const result = await runDetectPhase(
      ctx({ phases: ["links"] as EnrichPhase[] }),
      new Map(),
      new Map(),
      new Map(),
    );

    expect(result.phaseResult.status).toBe("skipped");
    expect(result.detectResults.size).toBe(0);
    expect(chat).not.toHaveBeenCalled();
  });

  it("fails the phase when every detect call died at the provider", async () => {
    // An empty result map used to read as "no non-brands found" and the phase
    // reported `succeeded` — the root cause of the 407 falsely-green targets on
    // 2026-08-02.
    chat.mockResolvedValue(providerDown);

    const result = await runDetectPhase(
      ctx({
        chunk: [brand, secondBrand],
        chunkBrandNames: ["Test Brand", "Second Brand"],
      }),
      new Map(),
      new Map(),
      new Map(),
    );

    expect(result.phaseResult.status).toBe("failed");
    expect(result.phaseResult.providerFailure).toBe(true);
    expect(result.phaseResult.error).toContain("all 2 detect call(s)");
  });

  it("keeps an empty result from a healthy provider on the succeeded path", async () => {
    chat.mockResolvedValue(healthyEmpty);

    const result = await runDetectPhase(ctx(), new Map(), new Map(), new Map());

    expect(result.phaseResult.status).toBe("succeeded");
    expect(result.phaseResult.providerFailure).toBeUndefined();
  });

  it("makes one detect call per brand, each with its own brand", async () => {
    chat.mockResolvedValue(healthyEmpty);

    await runDetectPhase(
      ctx({
        chunk: [brand, secondBrand],
        chunkBrandNames: ["Test Brand", "Second Brand"],
        jobId: "job-1",
      }),
      new Map([
        [
          "Second Brand",
          {
            urls: [],
            snippets: ["second snippet"],
            entries: [
              {
                title: "Second Brand",
                link: "https://second.example",
                snippet: "second snippet",
              },
            ],
          },
        ],
      ]),
      new Map(),
      new Map(),
    );

    expect(chat).toHaveBeenCalledTimes(2);
    // Calls run concurrently, so match per brand rather than by call order.
    const contexts = createClient.mock.calls.map(([, context]) => context);
    expect(contexts).toHaveLength(2);
    expect(contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "detect",
          target: { type: "brand", id: "brand-1" },
          jobId: "job-1",
        }),
        expect.objectContaining({
          phase: "detect",
          target: { type: "brand", id: "brand-2" },
          jobId: "job-1",
        }),
      ]),
    );
    expect(sentMessages()).toEqual(
      expect.arrayContaining([
        renderDetectUserMessage(baseItem),
        renderDetectUserMessage({
          ...baseItem,
          slug: "second-brand",
          name: "Second Brand",
          results: [
            {
              title: "Second Brand",
              snippet: "second snippet",
              host: "second.example",
              match: null,
            },
          ],
        }),
      ]),
    );
  });

  it("keeps the other brands' results when one brand's call fails", async () => {
    chat.mockImplementation(async ({ user }) =>
      user.includes("品牌 slug：test-brand\n") ? providerDown : brandVerdict,
    );

    const result = await runDetectPhase(
      ctx({
        chunk: [brand, secondBrand],
        chunkBrandNames: ["Test Brand", "Second Brand"],
      }),
      new Map(),
      new Map(),
      new Map(),
    );

    // One of two calls died at the provider: not every call, so the phase
    // succeeds and the healthy brand keeps its verdict.
    expect(result.phaseResult.status).toBe("succeeded");
    expect(result.detectResults.has("test-brand")).toBe(false);
    expect(result.detectResults.get("second-brand")?.slug).toBe("second-brand");
  });

  /**
   * DEV-1644 F10: the orchestrator probed every known URL and threw the answer
   * away, so detect judged brands on SERP snippets alone. The map is keyed by
   * TARGET ID, like every other per-brand map handed to a batch phase.
   */
  it("probe_evidence_reaches_detect_prompt", async () => {
    chat.mockResolvedValue(healthyEmpty);

    await runDetectPhase(
      ctx(),
      new Map(),
      new Map([
        [
          "brand-1",
          [
            {
              url: "https://test.example",
              title: "Test Brand Official Site",
              description: "Handmade ceramics from Taipei",
              platform: "instagram",
              status: 200,
            },
          ],
        ],
      ]),
      new Map(),
    );

    const message = firstMessage();
    expect(message).toBe(
      renderDetectUserMessage({
        ...baseItem,
        probes: [
          {
            url: "https://test.example",
            title: "Test Brand Official Site",
            description: "Handmade ceramics from Taipei",
            platform: "instagram",
            status: 200,
          },
        ],
      }),
    );
    expect(linesWith(message, "探測")).toEqual([
      "探測：Test Brand Official Site — Handmade ceramics from Taipei (instagram)",
    ]);
  });

  it("failed_probe_reaches_detect", async () => {
    chat.mockResolvedValue(healthyEmpty);

    await runDetectPhase(
      ctx(),
      new Map(),
      // A dead submitted site is evidence too: the probe read no <head>, but
      // its 404 says the page is gone. `status` survives into the prompt
      // (DEV-1894).
      new Map([["brand-1", [{ url: "https://test.example", status: 404 }]]]),
      new Map(),
    );

    expect(linesWith(firstMessage(), "探測")).toEqual([
      "探測：test.example — 無法連線（HTTP 404）",
    ]);
  });

  it("detect_item_carries_results_with_tags", async () => {
    chat.mockResolvedValue(healthyEmpty);

    await runDetectPhase(
      ctx(),
      new Map([
        [
          "Test Brand",
          {
            urls: [],
            snippets: ["own", "other"],
            entries: [
              {
                title: "Test Brand Official",
                link: "https://www.test.example/about",
                snippet: "own",
              },
              {
                title: "Someone Else",
                link: "https://other.example/test-brand",
                snippet: "other",
              },
            ],
          },
        ],
      ]),
      new Map(),
      new Map([["brand-1", ["https://test.example"]]]),
    );

    const message = firstMessage();
    const results = linesWith(message, "搜尋結果");
    expect(results).toHaveLength(2);
    // The result on the brand's own site is tagged; the other is not.
    expect(results[0]).toMatch(/^搜尋結果：Test Brand Official — own（.+，官網）$/);
    expect(results[1]).toBe("搜尋結果：Someone Else — other（other.example）");
    // Snippets reach the model only inside their result lines: five header
    // lines plus the two results, no separate snippet block.
    expect(message.split("\n")).toHaveLength(7);
  });

  it("detect_item_carries_submitted_website", async () => {
    chat.mockResolvedValue(healthyEmpty);

    await runDetectPhase(
      ctx({
        chunk: [{ ...brand, website_url: "https://submitted.example" }],
      }),
      new Map(),
      new Map(),
      new Map(),
    );

    expect(linesWith(firstMessage(), "提交網址")).toEqual([
      "提交網址：https://submitted.example",
    ]);
  });

  it("probe_cap_still_four", async () => {
    chat.mockResolvedValue(healthyEmpty);

    await runDetectPhase(
      ctx(),
      new Map(),
      new Map([
        [
          "brand-1",
          Array.from({ length: 6 }, (_, index) => ({
            url: `https://test.example/${index}`,
            title: `Page ${index}`,
          })),
        ],
      ]),
      new Map(),
    );

    expect(MAX_PROBE_URLS).toBe(4);
    expect(linesWith(firstMessage(), "探測")).toHaveLength(MAX_PROBE_URLS);
  });
});

describe("applyDetectResult", () => {
  it("returns non-brand skip result for high-confidence non-brands", () => {
    const result = applyDetectResult(
      {
        ...brandDetect,
        isNonBrand: true,
        nonBrandReason: "directory",
      },
      brand,
    );

    expect(result.isNonBrand).toBe(true);
    expect(result.phaseResult.status).toBe("skipped");
    expect(result.patch).toEqual({});
    expect(result.brandName).toBeNull();
  });

  it("returns brand result with detect patch for valid brands", () => {
    const result = applyDetectResult(brandDetect, brand);

    expect(result.isNonBrand).toBe(false);
    expect(result.phaseResult.status).toBe("succeeded");
    expect(result.patch).toEqual({ slug: "better-brand" });
  });

  it.each(["medium", "low"] as const)(
    "preserves the current slug when detect confidence is %s",
    (confidence) => {
      const result = applyDetectResult(
        { ...brandDetect, confidence, slugGenerated: "unapproved-slug" },
        { ...brand, slug: "current-slug" },
      );

      expect(result.patch).not.toHaveProperty("slug");
    },
  );

  // The detect prompt tells the model to return a null slug rather than
  // transliterate a Han name. The model obeys; the generateSlug fallback then
  // Wade-Giles romanised it anyway (`yuan-hsing-tung-fang-cha-yin-pur-sweets`).
  it("leaves the slug untouched for a Han name with no model slug", () => {
    const result = applyDetectResult(
      { ...brandDetect, slugGenerated: null, brandName: "茶籽堂 Cha Tzu Tang" },
      { ...brand, name: "茶籽堂", slug: "chatzutang" },
    );

    // `name` is no longer written here — DEV-1321 made `names` the single
    // writer, so detect only exposes the candidate.
    expect(result.patch).not.toHaveProperty("name");
    expect(result.brandName).toBe("茶籽堂 Cha Tzu Tang");
    expect(result.patch).not.toHaveProperty("slug");
  });

  it("still generates a slug for a Latin name with no model slug", () => {
    const result = applyDetectResult(
      { ...brandDetect, slugGenerated: null, brandName: "ADELA Studio" },
      { ...brand, name: "Adela", slug: "adela" },
    );

    expect(result.patch.slug).toBe("adela-studio");
    expect(result.patch).not.toHaveProperty("name");
    expect(result.brandName).toBe("ADELA Studio");
  });

});
