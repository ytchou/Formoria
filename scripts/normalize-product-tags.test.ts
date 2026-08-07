import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatAuditEvent } from "@/lib/audit";
import {
  createPlanningDeepSeekClient,
  createRunArtifact,
  composeResult,
  mapTagsWithLlm,
  parseArgs,
  parseRunArtifact,
  PLANNING_OPERATION,
  validateResults,
  type BrandRow,
} from "./normalize-product-tags";
import { planTagBackfill } from "@/lib/services/product-tags";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const brand = (overrides: Partial<BrandRow> = {}): BrandRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  slug: "sample-brand",
  product_type: "food",
  product_tags: ["食品禮盒", "側背包", "手工燈籠"],
  product_tags_en: ["Food Gift Box", "Crossbody", "Handmade Lantern"],
  status: "approved",
  ...overrides,
});

const modelAssistedResult = () => {
  const current = brand({
    product_tags: ["手工燈籠"],
    product_tags_en: ["Handmade Lantern"],
  });
  return composeResult(
    current,
    planTagBackfill(current.product_tags ?? []),
    new Map([["手工燈籠", null]]),
  );
};

const foodPlanningCall = {
  category: "food",
  operation: PLANNING_OPERATION,
} as const;

describe("normalize-product-tags safety contract", () => {
  it("captures every planning LLM response in the run audit evidence", async () => {
    const events: ChatAuditEvent[] = [];
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"手工燈籠":null}' } }],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 4,
              total_tokens: 16,
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const client = createPlanningDeepSeekClient(events);
    const mapping = await mapTagsWithLlm(client, "food", ["手工燈籠"]);

    expect(mapping.get("手工燈籠")).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: "deepseek",
      ok: true,
      status: 200,
      data: { choices: [{ message: { content: '{"手工燈籠":null}' } }] },
      usage: { total_tokens: 16 },
      request: {
        system: expect.stringContaining("product taxonomy"),
        user: expect.stringContaining("手工燈籠"),
        imageCount: 0,
      },
      retryAttempt: 0,
      meta: { category: "food", operation: PLANNING_OPERATION },
    });
    expect(events[0]?.latencyMs).toEqual(expect.any(Number));
  });

  it("defaults to planning and requires a reviewed artifact for apply", () => {
    expect(parseArgs([])).toMatchObject({
      apply: false,
      dryRun: true,
      artifactPath: null,
    });
    expect(() => parseArgs(["--apply"])).toThrow(/--artifact/);
    expect(() =>
      parseArgs(["--apply", "--dry-run", "--artifact=run.json"]),
    ).toThrow(/cannot be combined/);
    expect(parseArgs(["--apply", "--artifact=run.json"])).toMatchObject({
      apply: true,
      dryRun: false,
      artifactPath: "run.json",
    });
  });

  it("keeps preserved strategy labels byte-for-byte and retains their EN pair", () => {
    const current = brand();
    const result = composeResult(
      current,
      planTagBackfill(current.product_tags ?? []),
      new Map([["手工燈籠", null]]),
    );

    expect(result.afterZh).toContain("食品禮盒");
    expect(result.afterEn[result.afterZh.indexOf("食品禮盒")]).toBe(
      "Food Gift Box",
    );
    expect(result.perTagSource.get("食品禮盒")).toBe("preserved");
  });

  it("rejects plans that would remove every tag or exceed the five-tag cap", () => {
    const noTags = composeResult(
      brand({ product_tags: ["襪"], product_tags_en: ["Sock"] }),
      planTagBackfill(["襪"]),
      new Map([["襪", null]]),
    );
    expect(() => validateResults([noTags])).toThrow(/zero tags/);

    const sixTags = brand({
      product_tags: [
        "托特包",
        "後背包",
        "斜背包",
        "手提包",
        "水桶包",
        "零錢包",
      ],
      product_tags_en: null,
    });
    const capped = composeResult(
      sixTags,
      planTagBackfill(sixTags.product_tags ?? []),
      new Map(),
    );
    expect(capped.afterZh).toHaveLength(5);
    expect(() => validateResults([capped])).not.toThrow();
  });

  it("serializes paired before/after values and a concrete restoration snapshot", () => {
    const current = brand();
    const result = composeResult(
      current,
      planTagBackfill(current.product_tags ?? []),
      new Map([["手工燈籠", null]]),
    );
    const artifact = createRunArtifact([result], "2026-08-07T00:00:00.000Z");

    expect(artifact.rows[0]?.before.pairs).toEqual([
      { zh: "食品禮盒", en: "Food Gift Box" },
      { zh: "側背包", en: "Crossbody" },
      { zh: "手工燈籠", en: "Handmade Lantern" },
    ]);
    expect(artifact.rows[0]?.after.pairs).toEqual([
      { zh: "食品禮盒", en: "Food Gift Box" },
      { zh: "斜背包", en: "Crossbody Bags" },
      { zh: "手工燈籠", en: "Handmade Lantern" },
    ]);
    expect(artifact.rollback.rows[0]).toMatchObject({
      id: current.id,
      slug: current.slug,
      productTags: current.product_tags,
      productTagsEn: current.product_tags_en,
    });
    expect(() => parseRunArtifact(artifact, { requireApproval: true })).toThrow(
      /review/i,
    );

    const approved = structuredClone(artifact);
    approved.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-07T01:00:00.000Z",
    };
    expect(() => parseRunArtifact(approved, { requireApproval: true })).toThrow(
      /audit/i,
    );
  });

  it("rejects malformed paired values before an apply can start", () => {
    const current = brand();
    const result = composeResult(
      current,
      planTagBackfill(current.product_tags ?? []),
      new Map([["手工燈籠", null]]),
    );
    const artifact = createRunArtifact([result], "2026-08-07T00:00:00.000Z");
    const malformed = structuredClone(artifact);
    malformed.rows[0]!.after.pairs[0]!.zh = "tampered";

    expect(() => parseRunArtifact(malformed)).toThrow(/paired|after/i);
  });

  it("requires valid LLM audit evidence when an artifact is approved", () => {
    const artifact = createRunArtifact(
      [modelAssistedResult()],
      "2026-08-07T00:00:00.000Z",
      [
        {
          provider: "deepseek",
          model: "deepseek-v4-flash",
          ok: true,
          status: 200,
          data: { choices: [] },
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
          latencyMs: 12,
          request: { system: "s", user: "u", imageCount: 0 },
          retryAttempt: 0,
          meta: { category: "food", operation: PLANNING_OPERATION },
        },
      ],
      [foodPlanningCall],
    );
    artifact.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-07T01:00:00.000Z",
    };
    expect(
      parseRunArtifact(artifact, { requireApproval: true }).auditEvents,
    ).toHaveLength(1);

    const malformed = structuredClone(artifact);
    malformed.auditEvents[0]!.request.user = 42 as unknown as string;
    expect(() =>
      parseRunArtifact(malformed, { requireApproval: true }),
    ).toThrow(/audit/i);
  });

  it("rejects artifacts from the prior schema version", () => {
    const artifact = createRunArtifact([], "2026-08-07T00:00:00.000Z");
    const legacy = structuredClone(artifact) as unknown as Record<
      string,
      unknown
    >;
    legacy.version = 1;

    expect(() => parseRunArtifact(legacy)).toThrow(/unsupported version/i);
  });

  it("rejects approved plans with missing or uncorrelated planning evidence", () => {
    const result = modelAssistedResult();
    const artifact = createRunArtifact(
      [result],
      "2026-08-07T00:00:00.000Z",
      [],
      [foodPlanningCall],
    );
    artifact.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-07T01:00:00.000Z",
    };

    expect(() => parseRunArtifact(artifact, { requireApproval: true })).toThrow(
      /correlated audit evidence.*food/i,
    );

    const missingManifest = createRunArtifact(
      [result],
      "2026-08-07T00:00:00.000Z",
      [],
      [],
    );
    expect(() => parseRunArtifact(missingManifest)).toThrow(
      /planningCalls.*missing.*food/i,
    );

    const wrongCategory = structuredClone(artifact);
    wrongCategory.auditEvents = [
      {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        ok: true,
        status: 200,
        data: { choices: [] },
        usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
        latencyMs: 12,
        request: { system: "s", user: "u", imageCount: 0 },
        retryAttempt: 0,
        meta: { category: "home", operation: PLANNING_OPERATION },
      },
    ];
    expect(() =>
      parseRunArtifact(wrongCategory, { requireApproval: true }),
    ).toThrow(/correlated audit evidence.*food/i);

    const extraManifest = createRunArtifact(
      [result],
      "2026-08-07T00:00:00.000Z",
      [],
      [foodPlanningCall, { category: "home", operation: PLANNING_OPERATION }],
    );
    expect(() => parseRunArtifact(extraManifest)).toThrow(
      /planningCalls.*extra.*home/i,
    );
  });

  it("persists retry metadata and accepts failure evidence without usage", () => {
    const artifact = createRunArtifact(
      [modelAssistedResult()],
      "2026-08-07T00:00:00.000Z",
      [
        {
          provider: "deepseek",
          model: "deepseek-v4-flash",
          ok: false,
          status: 503,
          data: null,
          latencyMs: 12,
          request: { system: "s", user: "u", imageCount: 0 },
          retryAttempt: 2,
          error: "upstream unavailable",
          meta: { category: "food", operation: PLANNING_OPERATION },
        },
      ],
      [foodPlanningCall],
    );
    artifact.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-07T01:00:00.000Z",
    };

    const parsed = parseRunArtifact(artifact, { requireApproval: true });
    expect(parsed.auditEvents[0]).toMatchObject({
      ok: false,
      status: 503,
      retryAttempt: 2,
      error: "upstream unavailable",
    });

    const missingRetry = structuredClone(artifact);
    delete (missingRetry.auditEvents[0] as unknown as Record<string, unknown>)
      .retryAttempt;
    expect(() => parseRunArtifact(missingRetry)).toThrow(/retryAttempt/i);
  });
});
