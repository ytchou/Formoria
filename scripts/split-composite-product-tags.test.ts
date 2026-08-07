import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildClassifierPrompt,
  buildSplitRow,
  calculateScopeHash,
  classifyBrandWithLlm,
  createPlanningDeepSeekClient,
  createRunArtifact,
  digestRequest,
  parseArgs,
  parseClassifierAssignments,
  parseRunArtifact,
  PLANNING_OPERATION,
  SPLIT_DEFINITIONS,
  type BrandRow,
  type PlanningCall,
  type SplitRow,
} from "./split-composite-product-tags";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const brand = (overrides: Partial<BrandRow> = {}): BrandRow => ({
  id: "00000000-0000-4000-8000-000000000136",
  slug: "maria-garcia-studio",
  status: "approved",
  name: "瑪麗亞・生活選物 Maria García Studio",
  blurb: "手作居家香氛與茶飲，使用台灣植物素材。",
  description: "工作室製作擴香、茶包與季節選物，網站展示完整商品線。",
  site_content: { products: ["擴香", "茶包"] },
  product_type: "home",
  product_tags: ["香氛・蠟燭", "茶包・茶飲", "卡片・明信片"],
  product_tags_en: [
    "Home Fragrance & Candles",
    "Tea Bags & Drinks",
    "Cards & Postcards",
  ],
  ...overrides,
});

const promptForRow = (row: SplitRow) =>
  buildClassifierPrompt(
    {
      id: row.id,
      slug: row.slug,
      status: row.status,
      name: row.name,
      blurb: row.blurb,
      description: row.description,
      site_content: row.siteContent,
      product_type: row.productType,
      product_tags: row.before.productTags,
      product_tags_en: row.before.productTagsEn,
    },
    row.sourceLabels,
  );

const auditForRow = (row: SplitRow, retryAttempt = 0) => {
  const prompt = promptForRow(row);
  return {
    provider: "deepseek" as const,
    model: "deepseek-v4-flash",
    ok: true as const,
    status: 200,
    data: { choices: [{ message: { content: "{}" } }] },
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    latencyMs: 10,
    request: { system: prompt.system, user: prompt.user, imageCount: 0 },
    retryAttempt,
    meta: {
      operation: PLANNING_OPERATION,
      correlationId: row.callId,
      brandId: row.id,
      brandSlug: row.slug,
      sourceLabels: row.sourceLabels,
    },
  };
};

const failedAuditForRow = (row: SplitRow, retryAttempt = 0) => {
  const prompt = promptForRow(row);
  return {
    provider: "deepseek" as const,
    model: "deepseek-v4-flash",
    ok: false as const,
    status: 503,
    data: { error: { message: "temporary provider failure" } },
    usage: { prompt_tokens: 12, completion_tokens: 0, total_tokens: 12 },
    latencyMs: 10,
    request: { system: prompt.system, user: prompt.user, imageCount: 0 },
    retryAttempt,
    meta: {
      operation: PLANNING_OPERATION,
      correlationId: row.callId,
      brandId: row.id,
      brandSlug: row.slug,
      sourceLabels: row.sourceLabels,
    },
    error: "temporary provider failure",
  };
};

const artifactForRow = (row: SplitRow) => {
  const prompt = promptForRow(row);
  return createRunArtifact(
    [row],
    [
      {
        callId: row.callId,
        brandId: row.id,
        brandSlug: row.slug,
        sourceLabels: row.sourceLabels,
        operation: PLANNING_OPERATION,
        requestDigest: digestRequest(prompt.system, prompt.user),
      },
    ],
    [auditForRow(row)],
    "2026-08-08T00:00:00.000Z",
  );
};

describe("DEV-1361 split planner", () => {
  it("defines exactly the eight retired source pairs", () => {
    expect(SPLIT_DEFINITIONS).toHaveLength(8);
    expect(SPLIT_DEFINITIONS.map((definition) => definition.source)).toEqual([
      "香氛・蠟燭",
      "鑰匙圈・吊飾",
      "收納包・化妝包",
      "茶包・茶飲",
      "玩具・教具",
      "花藝・植栽",
      "毛巾・生活織品",
      "手機袋・手機背帶",
    ]);
  });

  it("uses brand evidence to produce one or both atomic replacements while preserving valid synonyms", () => {
    const current = brand();
    const row = buildSplitRow(current, "call-1361", [
      {
        sourceLabel: "香氛・蠟燭",
        decision: "one",
        targetSlugs: ["home-fragrance"],
        rationale:
          "The description and site products name room fragrance, not candles.",
      },
      {
        sourceLabel: "茶包・茶飲",
        decision: "both",
        targetSlugs: ["tea-bags", "tea-drinks"],
        rationale: "The evidence names both tea bags and prepared drinks.",
      },
    ]);

    expect(row.after.productTags).toEqual([
      "居家香氛",
      "茶包",
      "茶飲",
      "卡片・明信片",
    ]);
    expect(row.after.productTagsEn).toEqual([
      "Home Fragrance",
      "Tea Bags",
      "Tea Drinks",
      "Cards & Postcards",
    ]);
    expect(row.assignments.map((assignment) => assignment.sourceLabel)).toEqual(
      ["香氛・蠟燭", "茶包・茶飲"],
    );
    expect(row.after.productTags).not.toContain("香氛・蠟燭");
    expect(row.after.productTags).not.toContain("茶包・茶飲");
  });

  it("removes an evidence-backed false-positive composite without changing other tag pairs", () => {
    const current = brand({
      product_tags: ["卡片・明信片", "香氛・蠟燭", "茶葉"],
      product_tags_en: ["Cards & Postcards", "Home Fragrance & Candles", "Tea"],
    });
    const row = buildSplitRow(current, "call-neither", [
      {
        sourceLabel: "香氛・蠟燭",
        decision: "neither",
        targetSlugs: [],
        rationale:
          "The brand sells cards and tea only; the composite label is a false positive.",
      },
    ]);

    expect(row.after.productTags).toEqual(["卡片・明信片", "茶葉"]);
    expect(row.after.productTagsEn).toEqual(["Cards & Postcards", "Tea"]);
    expect(row.overflowReview.status).toBe("none");

    const artifact = artifactForRow(row);
    artifact.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-08T01:00:00.000Z",
    };
    expect(artifact.summary.sourceDecisions).toMatchObject({
      one: 0,
      both: 0,
      neither: 1,
      "needs-review": 0,
    });
    expect(artifact.summary.targetAssignments).toEqual({});
    expect(
      parseRunArtifact(artifact, { requireApproval: true }).rows[0]?.after,
    ).toMatchObject({
      productTags: ["卡片・明信片", "茶葉"],
      productTagsEn: ["Cards & Postcards", "Tea"],
    });
  });

  it("blocks a neither decision that would leave a brand with zero tags", () => {
    const row = buildSplitRow(
      brand({
        product_tags: ["香氛・蠟燭"],
        product_tags_en: ["Home Fragrance & Candles"],
      }),
      "call-neither-zero",
      [
        {
          sourceLabel: "香氛・蠟燭",
          decision: "neither",
          targetSlugs: [],
          rationale: "No product evidence supports either atomic target.",
        },
      ],
    );
    expect(row.after.productTags).toEqual([]);
    expect(row.overflowReview.status).toBe("none");
    expect(() => artifactForRow(row)).toThrow(/zero tags/i);
  });

  it("keeps an ambiguous source visible but marks it needs-review", () => {
    const row = buildSplitRow(
      brand({
        product_tags: ["香氛・蠟燭"],
        product_tags_en: ["Home Fragrance & Candles"],
      }),
      "call-review",
      [
        {
          sourceLabel: "香氛・蠟燭",
          decision: "needs-review",
          targetSlugs: [],
          rationale:
            "The evidence does not distinguish candles from fragrance.",
        },
      ],
    );

    expect(row.after.productTags).toEqual(["香氛・蠟燭"]);
    expect(row.assignments[0]?.decision).toBe("needs-review");
    const prompt = promptForRow(row);
    expect(() =>
      parseRunArtifact(
        createRunArtifact(
          [row],
          [
            {
              callId: "call-review",
              brandId: row.id,
              brandSlug: row.slug,
              sourceLabels: row.sourceLabels,
              operation: PLANNING_OPERATION,
              requestDigest: digestRequest(prompt.system, prompt.user),
            },
          ],
        ),
        { requireApproval: true },
      ),
    ).toThrow(/approved|audit|needs-review/i);
  });

  it("rejects malformed classifier assignments instead of guessing a target", () => {
    const parsed = parseClassifierAssignments(
      JSON.stringify({
        assignments: {
          "香氛・蠟燭": { decision: "one", targetSlugs: ["not-a-target"] },
        },
      }),
      ["香氛・蠟燭"],
    );
    expect(parsed).toEqual([
      {
        sourceLabel: "香氛・蠟燭",
        decision: "needs-review",
        targetSlugs: [],
        rationale: "Classifier returned invalid replacement slugs",
      },
    ]);

    expect(
      parseClassifierAssignments(
        JSON.stringify({
          assignments: {
            "香氛・蠟燭": {
              decision: "one",
              targetSlugs: ["home-fragrance", "candles"],
            },
          },
        }),
        ["香氛・蠟燭"],
      )[0],
    ).toMatchObject({ decision: "needs-review", targetSlugs: [] });
    expect(
      parseClassifierAssignments(
        JSON.stringify({
          assignments: {
            "香氛・蠟燭": {
              decision: "both",
              targetSlugs: ["home-fragrance"],
            },
          },
        }),
        ["香氛・蠟燭"],
      )[0],
    ).toMatchObject({ decision: "needs-review", targetSlugs: [] });

    expect(
      parseClassifierAssignments(
        JSON.stringify({
          assignments: {
            "香氛・蠟燭": {
              decision: "neither",
              targetSlugs: ["home-fragrance"],
              rationale: "Malformed false-positive response.",
            },
          },
        }),
        ["香氛・蠟燭"],
      )[0],
    ).toMatchObject({ decision: "needs-review", targetSlugs: [] });
    expect(
      parseClassifierAssignments(
        JSON.stringify({
          assignments: {
            "香氛・蠟燭": {
              decision: "neither",
              targetSlugs: [],
            },
          },
        }),
        ["香氛・蠟燭"],
      )[0],
    ).toMatchObject({ decision: "needs-review", targetSlugs: [] });
    expect(
      parseClassifierAssignments(
        JSON.stringify({
          assignments: {
            "香氛・蠟燭": {
              decision: "neither",
              targetSlugs: [],
              rationale: "The evidence shows no candles or room fragrance.",
            },
          },
        }),
        ["香氛・蠟燭"],
      )[0],
    ).toEqual({
      sourceLabel: "香氛・蠟燭",
      decision: "neither",
      targetSlugs: [],
      rationale: "The evidence shows no candles or room fragrance.",
    });
  });

  it("rejects inconsistent reviewed assignment semantics in an artifact", () => {
    const row = buildSplitRow(
      brand({
        product_tags: ["香氛・蠟燭"],
        product_tags_en: ["Home Fragrance & Candles"],
      }),
      "call-inconsistent",
      [
        {
          sourceLabel: "香氛・蠟燭",
          decision: "one",
          targetSlugs: ["home-fragrance"],
          rationale: "Room fragrance evidence.",
        },
      ],
    );
    const artifact = artifactForRow(row);
    artifact.rows[0]!.assignments[0]!.targetSlugs = [
      "home-fragrance",
      "candles",
    ];
    expect(() => parseRunArtifact(artifact)).toThrow(
      /replacement slugs|invalid/i,
    );
  });

  it("captures evidence in the classifier prompt and makes its request digest immutable", () => {
    const current = brand();
    const prompt = buildClassifierPrompt(current, ["香氛・蠟燭"]);
    expect(prompt.user).toContain("Maria García Studio");
    expect(prompt.user).toContain("擴香");
    expect(prompt.user).toContain("香氛・蠟燭");
    expect(prompt.system).toContain("neither");
    expect(prompt.user).toContain("For neither, targetSlugs must be []");
    expect(digestRequest(prompt.system, prompt.user)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("correlates the adapter audit event to the per-brand planning call", async () => {
    const auditEvents: import("@/lib/audit").ChatAuditEvent[] = [];
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assignments: {
                      "香氛・蠟燭": {
                        decision: "one",
                        targetSlugs: ["home-fragrance"],
                        rationale: "擴香 appears in the evidence.",
                      },
                    },
                  }),
                },
              },
            ],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 8,
              total_tokens: 20,
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await classifyBrandWithLlm(
      createPlanningDeepSeekClient(auditEvents),
      brand({
        product_tags: ["香氛・蠟燭"],
        product_tags_en: ["Home Fragrance & Candles"],
      }),
      ["香氛・蠟燭"],
      "call-http",
    );

    expect(result.assignments[0]).toMatchObject({
      decision: "one",
      targetSlugs: ["home-fragrance"],
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({
      ok: true,
      meta: {
        operation: PLANNING_OPERATION,
        correlationId: "call-http",
        brandId: brand().id,
      },
      request: { user: expect.stringContaining("Maria García Studio") },
    });
  });

  it("round-trips an approved artifact only with correlated audit evidence", () => {
    const current = brand({
      product_tags: ["香氛・蠟燭"],
      product_tags_en: ["Home Fragrance & Candles"],
    });
    const row = buildSplitRow(current, "call-approved", [
      {
        sourceLabel: "香氛・蠟燭",
        decision: "one",
        targetSlugs: ["home-fragrance"],
        rationale: "Room fragrance appears in evidence.",
      },
    ]);
    const prompt = buildClassifierPrompt(current, row.sourceLabels);
    const planningCall: PlanningCall = {
      callId: row.callId,
      brandId: row.id,
      brandSlug: row.slug,
      sourceLabels: row.sourceLabels,
      operation: PLANNING_OPERATION,
      requestDigest: digestRequest(prompt.system, prompt.user),
    };
    const artifact = createRunArtifact(
      [row],
      [planningCall],
      [
        {
          provider: "deepseek",
          model: "deepseek-v4-flash",
          ok: true,
          status: 200,
          data: { choices: [{ message: { content: "{}" } }] },
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
          latencyMs: 10,
          request: { system: prompt.system, user: prompt.user, imageCount: 0 },
          retryAttempt: 0,
          meta: {
            operation: PLANNING_OPERATION,
            correlationId: row.callId,
            brandId: row.id,
            brandSlug: row.slug,
            sourceLabels: row.sourceLabels,
          },
        },
      ],
      "2026-08-08T00:00:00.000Z",
    );
    artifact.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-08T01:00:00.000Z",
    };

    expect(
      parseRunArtifact(artifact, { requireApproval: true }).rows[0]?.after
        .productTags,
    ).toEqual(["居家香氛"]);

    const tampered = structuredClone(artifact);
    tampered.auditEvents[0]!.meta!.correlationId = "other-call";
    expect(() => parseRunArtifact(tampered, { requireApproval: true })).toThrow(
      /correlated|unknown/i,
    );
  });

  it("rejects tampered neither after-state and rollback values", () => {
    const row = buildSplitRow(
      brand({
        product_tags: ["香氛・蠟燭", "卡片・明信片"],
        product_tags_en: ["Home Fragrance & Candles", "Cards & Postcards"],
      }),
      "call-neither-integrity",
      [
        {
          sourceLabel: "香氛・蠟燭",
          decision: "neither",
          targetSlugs: [],
          rationale:
            "The evidence confirms the composite was a false positive.",
        },
      ],
    );
    const artifact = artifactForRow(row);
    artifact.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-08T01:00:00.000Z",
    };

    const tamperedAfter = structuredClone(artifact);
    tamperedAfter.rows[0]!.after = {
      productTags: ["居家香氛", "卡片・明信片"],
      productTagsEn: ["Home Fragrance", "Cards & Postcards"],
      pairs: [
        { zh: "居家香氛", en: "Home Fragrance" },
        { zh: "卡片・明信片", en: "Cards & Postcards" },
      ],
    };
    expect(() => parseRunArtifact(tamperedAfter)).toThrow(/after tags/i);

    const tamperedRollback = structuredClone(artifact);
    tamperedRollback.rollback.rows[0]!.productTags = ["卡片・明信片"];
    expect(() => parseRunArtifact(tamperedRollback)).toThrow(/rollback/i);
  });

  it("requires one deterministic call and complete DeepSeek audit evidence per row", () => {
    const row = buildSplitRow(
      brand({
        product_tags: ["香氛・蠟燭"],
        product_tags_en: ["Home Fragrance & Candles"],
      }),
      "call-audit-shape",
      [
        {
          sourceLabel: "香氛・蠟燭",
          decision: "one",
          targetSlugs: ["home-fragrance"],
          rationale: "Room fragrance evidence.",
        },
      ],
    );
    const missingEvent = artifactForRow(row);
    missingEvent.auditEvents = [];
    expect(() => parseRunArtifact(missingEvent)).toThrow(
      /audit evidence|call/i,
    );

    const duplicateCall = artifactForRow(row);
    duplicateCall.planningCalls.push(duplicateCall.planningCalls[0]!);
    expect(() => parseRunArtifact(duplicateCall)).toThrow(
      /exactly one planning|duplicate/i,
    );

    const extraEvent = artifactForRow(row);
    extraEvent.auditEvents.push(extraEvent.auditEvents[0]!);
    expect(() => parseRunArtifact(extraEvent)).toThrow(
      /retryAttempt|duplicate|after terminal success/i,
    );

    const incomplete = artifactForRow(row);
    incomplete.auditEvents[0]!.provider = "openai";
    expect(() => parseRunArtifact(incomplete)).toThrow(/deepseek/i);
    const noPayload = artifactForRow(row);
    delete (noPayload.auditEvents[0] as Record<string, unknown>).data;
    expect(() => parseRunArtifact(noPayload)).toThrow(/payload\/data/i);
    const noLatency = artifactForRow(row);
    delete (noLatency.auditEvents[0] as Record<string, unknown>).latencyMs;
    expect(() => parseRunArtifact(noLatency)).toThrow(/latencyMs/i);
    const noRetry = artifactForRow(row);
    delete (noRetry.auditEvents[0] as Record<string, unknown>).retryAttempt;
    expect(() => parseRunArtifact(noRetry)).toThrow(/retryAttempt/i);
    const incompleteUsage = artifactForRow(row);
    delete (incompleteUsage.auditEvents[0]!.usage as Record<string, unknown>)
      .total_tokens;
    expect(() => parseRunArtifact(incompleteUsage)).toThrow(/token usage/i);
  });

  it("accepts failed retry attempts before one terminal success and preserves every event", () => {
    const row = buildSplitRow(
      brand({
        product_tags: ["香氛・蠟燭"],
        product_tags_en: ["Home Fragrance & Candles"],
      }),
      "call-retry-chain",
      [
        {
          sourceLabel: "香氛・蠟燭",
          decision: "one",
          targetSlugs: ["home-fragrance"],
          rationale: "Room fragrance evidence.",
        },
      ],
    );
    const prompt = promptForRow(row);
    const planningCall: PlanningCall = {
      callId: row.callId,
      brandId: row.id,
      brandSlug: row.slug,
      sourceLabels: row.sourceLabels,
      operation: PLANNING_OPERATION,
      requestDigest: digestRequest(prompt.system, prompt.user),
    };
    const artifact = createRunArtifact(
      [row],
      [planningCall],
      [failedAuditForRow(row, 0), auditForRow(row, 1)],
      "2026-08-08T00:00:00.000Z",
    );

    expect(artifact.auditEvents).toHaveLength(2);
    expect(
      artifact.auditEvents.map((event) => [event.ok, event.retryAttempt]),
    ).toEqual([
      [false, 0],
      [true, 1],
    ]);
    expect(parseRunArtifact(artifact).auditEvents).toHaveLength(2);
  });

  it("rejects incomplete, duplicate, reordered, tampered, and all-failed retry chains", () => {
    const row = buildSplitRow(
      brand({
        product_tags: ["香氛・蠟燭"],
        product_tags_en: ["Home Fragrance & Candles"],
      }),
      "call-retry-adversarial",
      [
        {
          sourceLabel: "香氛・蠟燭",
          decision: "one",
          targetSlugs: ["home-fragrance"],
          rationale: "Room fragrance evidence.",
        },
      ],
    );
    const prompt = promptForRow(row);
    const planningCall: PlanningCall = {
      callId: row.callId,
      brandId: row.id,
      brandSlug: row.slug,
      sourceLabels: row.sourceLabels,
      operation: PLANNING_OPERATION,
      requestDigest: digestRequest(prompt.system, prompt.user),
    };
    const artifact = (events: import("@/lib/audit").ChatAuditEvent[]) =>
      createRunArtifact(
        [row],
        [planningCall],
        events,
        "2026-08-08T00:00:00.000Z",
      );

    expect(() => artifact([auditForRow(row, 1)])).toThrow(
      /retryAttempt|contiguous/i,
    );
    expect(() =>
      artifact([
        failedAuditForRow(row, 0),
        failedAuditForRow(row, 0),
        auditForRow(row, 1),
      ]),
    ).toThrow(/retryAttempt|contiguous/i);
    expect(() =>
      artifact([
        failedAuditForRow(row, 1),
        failedAuditForRow(row, 0),
        auditForRow(row, 2),
      ]),
    ).toThrow(/retryAttempt|contiguous/i);

    const tamperedFailure = failedAuditForRow(row, 0);
    tamperedFailure.request.user = "tampered request";
    expect(() => artifact([tamperedFailure, auditForRow(row, 1)])).toThrow(
      /stored evidence|digest/i,
    );
    expect(() =>
      artifact([failedAuditForRow(row, 0), failedAuditForRow(row, 1)]),
    ).toThrow(/terminal success|success/i);
    expect(() =>
      artifact([auditForRow(row, 0), failedAuditForRow(row, 1)]),
    ).toThrow(/after terminal success|terminal success/i);
  });

  it("recomputes the classifier request from stored row evidence", () => {
    const row = buildSplitRow(
      brand({
        product_tags: ["香氛・蠟燭"],
        product_tags_en: ["Home Fragrance & Candles"],
      }),
      "call-evidence-integrity",
      [
        {
          sourceLabel: "香氛・蠟燭",
          decision: "one",
          targetSlugs: ["home-fragrance"],
          rationale: "Room fragrance evidence.",
        },
      ],
    );
    const artifact = artifactForRow(row);
    artifact.rows[0]!.description = "Tampered description";
    artifact.scope.scopeHash = calculateScopeHash(artifact.rows);
    expect(() => parseRunArtifact(artifact)).toThrow(/stored evidence|digest/i);
  });

  it("keeps five-tag overflow visible until an explicit non-source eviction is reviewed", () => {
    const row = buildSplitRow(
      brand({
        product_tags: ["香氛・蠟燭", "卡片・明信片", "托特包", "茶葉", "耳環"],
        product_tags_en: [
          "Home Fragrance & Candles",
          "Cards & Postcards",
          "Tote Bags",
          "Tea",
          "Earrings",
        ],
      }),
      "call-overflow",
      [
        {
          sourceLabel: "香氛・蠟燭",
          decision: "both",
          targetSlugs: ["home-fragrance", "candles"],
          rationale: "Evidence names both products.",
        },
      ],
    );
    expect(row.after.productTags).toHaveLength(6);
    expect(row.overflowReview.status).toBe("needs-review");
    expect(row.overflowReview.candidates.map((pair) => pair.zh)).toEqual([
      "卡片・明信片",
      "托特包",
      "茶葉",
      "耳環",
    ]);
    const pending = artifactForRow(row);
    expect(parseRunArtifact(pending).rows[0]?.overflowReview.status).toBe(
      "needs-review",
    );
    pending.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-08T01:00:00.000Z",
    };
    expect(() => parseRunArtifact(pending, { requireApproval: true })).toThrow(
      /overflow|eviction/i,
    );

    const approved = artifactForRow(row);
    const evicted = row.overflowReview.candidates[0]!;
    const finalPairs = row.after.pairs.filter((pair) => pair.zh !== evicted.zh);
    approved.rows[0]!.overflowReview = {
      status: "approved",
      candidates: row.overflowReview.candidates,
      evicted: [evicted],
      rationale: "Cards are outside this brand's product line.",
    };
    approved.rows[0]!.after = {
      productTags: finalPairs.map((pair) => pair.zh),
      productTagsEn: finalPairs.map((pair) => pair.en ?? pair.zh),
      pairs: finalPairs,
    };
    approved.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-08T01:00:00.000Z",
    };
    expect(
      parseRunArtifact(approved, { requireApproval: true }).rows[0]?.after
        .productTags,
    ).toHaveLength(5);

    const sourceEviction = artifactForRow(row);
    sourceEviction.rows[0]!.overflowReview = {
      status: "approved",
      candidates: row.overflowReview.candidates,
      evicted: [row.before.pairs[0]!],
      rationale: "Invalid source eviction.",
    };
    sourceEviction.rows[0]!.after = {
      productTags: row.after.productTags.slice(0, 5),
      productTagsEn: row.after.productTagsEn.slice(0, 5),
      pairs: row.after.pairs.slice(0, 5),
    };
    expect(() => parseRunArtifact(sourceEviction)).toThrow(
      /retired source|candidate|before tag/i,
    );
  });

  it("writes first, validates every final snapshot, then revalidates each changed slug once", async () => {
    const current = brand({
      product_tags: ["香氛・蠟燭"],
      product_tags_en: ["Home Fragrance & Candles"],
    });
    const row = buildSplitRow(current, "call-apply-sequence", [
      {
        sourceLabel: "香氛・蠟燭",
        decision: "one",
        targetSlugs: ["home-fragrance"],
        rationale: "Evidence names room fragrance.",
      },
    ]);
    const artifact = artifactForRow(row);
    artifact.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-08T01:00:00.000Z",
    };
    let state = structuredClone(current);
    const revalidated: string[] = [];
    const result = await import("./split-composite-product-tags").then(
      ({ applyRunArtifact }) =>
        applyRunArtifact({} as never, artifact, {
          loadScope: async () => [structuredClone(state)],
          loadSnapshot: async () => structuredClone(state),
          update: async (_id, data) => {
            state = {
              ...state,
              product_tags: data.productTags,
              product_tags_en: data.productTagsEn,
            };
            return {
              productTags: data.productTags,
              productTagsEn: data.productTagsEn,
              productType: state.product_type,
              skipped: [],
            };
          },
          revalidate: async ({ slug }) => {
            revalidated.push(slug);
          },
        }),
    );
    expect(result).toEqual({
      writeCount: 1,
      revalidatedSlugs: [current.slug],
    });
    expect(revalidated).toEqual([current.slug]);
    expect(state.product_tags).toEqual(["居家香氛"]);
  });

  it("applies a reviewed neither decision without replacement or overflow", async () => {
    const current = brand({
      product_tags: ["香氛・蠟燭", "卡片・明信片"],
      product_tags_en: ["Home Fragrance & Candles", "Cards & Postcards"],
    });
    const row = buildSplitRow(current, "call-apply-neither", [
      {
        sourceLabel: "香氛・蠟燭",
        decision: "neither",
        targetSlugs: [],
        rationale:
          "The legacy composite is not supported by this brand's evidence.",
      },
    ]);
    const artifact = artifactForRow(row);
    artifact.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-08T01:00:00.000Z",
    };
    let state = structuredClone(current);
    const { applyRunArtifact } = await import("./split-composite-product-tags");
    const result = await applyRunArtifact({} as never, artifact, {
      loadScope: async () => [structuredClone(state)],
      loadSnapshot: async () => structuredClone(state),
      update: async (_id, data) => {
        state = {
          ...state,
          product_tags: data.productTags,
          product_tags_en: data.productTagsEn,
        };
        return {
          productTags: data.productTags,
          productTagsEn: data.productTagsEn,
          productType: state.product_type,
          skipped: [],
        };
      },
      revalidate: async () => undefined,
    });

    expect(result.writeCount).toBe(1);
    expect(state.product_tags).toEqual(["卡片・明信片"]);
    expect(state.product_tags_en).toEqual(["Cards & Postcards"]);
  });

  it("blocks revalidation when final reread detects a product-type or tag drift", async () => {
    const current = brand({
      product_tags: ["香氛・蠟燭"],
      product_tags_en: ["Home Fragrance & Candles"],
    });
    const row = buildSplitRow(current, "call-apply-final-drift", [
      {
        sourceLabel: "香氛・蠟燭",
        decision: "one",
        targetSlugs: ["home-fragrance"],
        rationale: "Evidence names room fragrance.",
      },
    ]);
    const artifact = artifactForRow(row);
    artifact.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-08T01:00:00.000Z",
    };
    let state = structuredClone(current);
    let revalidateCount = 0;
    const { applyRunArtifact } = await import("./split-composite-product-tags");
    await expect(
      applyRunArtifact({} as never, artifact, {
        loadScope: async () => [structuredClone(state)],
        loadSnapshot: async () => structuredClone(state),
        update: async (_id, data) => {
          state = {
            ...state,
            product_tags: data.productTags,
            product_tags_en: data.productTagsEn,
            product_type: "crafts",
          };
          return {
            productTags: data.productTags,
            productTagsEn: data.productTagsEn,
            productType: state.product_type,
            skipped: [],
          };
        },
        revalidate: async () => {
          revalidateCount += 1;
        },
      }),
    ).rejects.toThrow(
      /write verification|product.type|final validation|persisted/i,
    );
    expect(revalidateCount).toBe(0);
  });

  it("surfaces revalidation failure after all final row checks pass", async () => {
    const current = brand({
      product_tags: ["香氛・蠟燭"],
      product_tags_en: ["Home Fragrance & Candles"],
    });
    const row = buildSplitRow(current, "call-revalidate-failure", [
      {
        sourceLabel: "香氛・蠟燭",
        decision: "one",
        targetSlugs: ["home-fragrance"],
        rationale: "Evidence names room fragrance.",
      },
    ]);
    const artifact = artifactForRow(row);
    artifact.review = {
      status: "approved",
      reviewer: "taxonomy-reviewer",
      reviewedAt: "2026-08-08T01:00:00.000Z",
    };
    let state = structuredClone(current);
    const { applyRunArtifact } = await import("./split-composite-product-tags");
    await expect(
      applyRunArtifact({} as never, artifact, {
        loadScope: async () => [structuredClone(state)],
        loadSnapshot: async () => structuredClone(state),
        update: async (_id, data) => {
          state = {
            ...state,
            product_tags: data.productTags,
            product_tags_en: data.productTagsEn,
          };
          return {
            productTags: data.productTags,
            productTagsEn: data.productTagsEn,
            productType: state.product_type,
            skipped: [],
          };
        },
        revalidate: async () => {
          throw new Error("cache service unavailable");
        },
      }),
    ).rejects.toThrow(/revalidation failed.*cache service unavailable/i);
  });

  it("requires apply arguments to name an exact artifact path", () => {
    expect(parseArgs([])).toMatchObject({
      apply: false,
      dryRun: true,
      artifactPath: null,
    });
    expect(() => parseArgs(["--apply"])).toThrow(/artifact/);
    expect(parseArgs(["--apply", "--artifact=reviewed.json"])).toMatchObject({
      apply: true,
      dryRun: false,
      artifactPath: "reviewed.json",
    });
  });

  it("changes the scope hash when a reviewed baseline changes", () => {
    const current = brand({
      product_tags: ["香氛・蠟燭"],
      product_tags_en: ["Home Fragrance & Candles"],
    });
    const row = buildSplitRow(current, "call-hash", [
      {
        sourceLabel: "香氛・蠟燭",
        decision: "one",
        targetSlugs: ["candles"],
        rationale: "Evidence names candles.",
      },
    ]);
    const changed = buildSplitRow(
      { ...current, description: "A changed description" },
      "call-hash",
      row.assignments,
    );
    expect(calculateScopeHash([row])).not.toBe(calculateScopeHash([changed]));
  });
});
