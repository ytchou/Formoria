import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import type { DirectoryHealthInput } from "./directory";
import {
  cleanupStaleBranches,
  createRpcClient,
  createWorkflowRuntimeDependencies,
  deliverRepairFailure,
  deliverRepairResult,
  enqueueAndClaimWorkflowBatch,
  finalizeSentryArtifact,
  makeDirectoryArtifact,
  makeLinkArtifact,
  runWorkflowCommand,
  runAggregateAndDeliver,
  type RepairFailureInput,
  type RepairResultInput,
} from "./workflow-runtime";

const now = "2026-07-22T00:00:00.000Z";
const automaticFindingIds = [
  "e490b9bc-006f-46b9-9838-91f19fbdaf29",
  "77735d6d-c378-4734-b4f7-3d93747c1022",
];
const humanFindingIds = ["2437fd75-9edc-4e70-815d-a578d4886234"];
const automaticRepairFindings = [
  {
    behaviorChangeRisk: "low",
    changedFiles: ["src/cart/cart-service.ts"],
    claimedFindingId: automaticFindingIds[0],
    confidence: 0.96,
    defectKind: "application",
    evidence: { classification: { rootCause: "Missing cart item guard" } },
    evidenceArtifactRef: "sentry-triage:cart-missing-item",
    fingerprint: "sentry:issue:cart-missing-item",
    fixability: "high",
    mergePolicy: "automatic",
    reproducible: true,
    rootCauseKey: "cart-missing-item",
    sensitivePaths: [],
    severity: "high",
    source: "sentry",
    title: "Cart service does not guard a missing item",
  },
  {
    behaviorChangeRisk: "low",
    changedFiles: ["src/cart/cart-service.ts"],
    claimedFindingId: automaticFindingIds[1],
    confidence: 0.93,
    defectKind: "application",
    evidence: { classification: { rootCause: "Missing cart item guard" } },
    evidenceArtifactRef: "directory-health:cart-missing-item",
    fingerprint: "directory:runtime:cart-missing-item",
    fixability: "high",
    mergePolicy: "automatic",
    reproducible: true,
    rootCauseKey: "cart-missing-item",
    sensitivePaths: [],
    severity: "medium",
    source: "directory",
    title: "Directory cart check reaches the same missing-item defect",
  },
];

function repairResultInput(
  mergePolicy: "automatic" | "human",
): RepairResultInput {
  return {
    autoMergeEnabled: mergePolicy === "automatic",
    leaseOwner: "github-actions:987654321:1",
    mergePolicy,
    metadataPath: "repair-metadata.json",
    outputPath: `${mergePolicy}-pr-result.json`,
    prNumber: mergePolicy === "automatic" ? 142 : 143,
    prUrl: `https://github.com/ytchou/Formoria/pull/${mergePolicy === "automatic" ? 142 : 143}`,
    runAt: now,
    workflowAttempt: 1,
    workflowRunId: "987654321",
  };
}

function repairFailureInput(): RepairFailureInput {
  return {
    leaseOwner: "github-actions:987654321:1",
    mergePolicy: "automatic",
    metadataPath: "repair-metadata.json",
    outputPath: "automatic-repair-failure.json",
    runAt: now,
    snapshotPath: "automatic-snapshot.json",
    workflowAttempt: 1,
    workflowRunId: "987654321",
  };
}

function repairResultFiles() {
  const contents = new Map<string, string>([
    [
      "repair-metadata.json",
      JSON.stringify({
        automatic: { claimed_finding_ids: automaticFindingIds },
        human: { claimed_finding_ids: humanFindingIds },
      }),
    ],
    [
      "automatic-snapshot.json",
      JSON.stringify({ findings: automaticRepairFindings }),
    ],
  ]);
  return {
    contents,
    files: {
      read: async (path: string) => contents.get(path) ?? "",
      write: async (path: string, value: string) => {
        contents.set(path, value);
      },
    },
  };
}

function transitionFetch() {
  return vi.fn<typeof fetch>(async () =>
    Promise.resolve(
      new Response(JSON.stringify({ id: "transitioned-finding" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    ),
  );
}

function directoryInput(): DirectoryHealthInput {
  return {
    approvedBrands: { addedToday: 0, gaps: [], totalApproved: 12 },
    branches: [],
    database: {
      activeQueries: [],
      connections: { maximum: 100, total: 10 },
      deadTupleSnapshots: [],
      indexConcerns: [],
    },
    dependabot: [],
    links: [],
    nowIso: now,
  };
}

function staleBranchFinding(branch: string, tipSha: string) {
  return {
    evidence: { branchRef: branch, currentRemoteTipSha: tipSha },
    fingerprint: `directory:stale-branch:${tipSha}`,
    mergePolicy: "automatic" as const,
    severity: "low" as const,
    source: "directory" as const,
    title: "Merged stale branch is safe to remove",
  };
}

function aggregateArtifact(findings: readonly unknown[]) {
  return {
    artifacts: {
      "directory-health": {
        collectedAt: now,
        evidence: {},
        failures: [],
        findings,
        routine: "directory-health",
        skippedActions: [],
        status: "success",
        version: 1,
      },
    },
  };
}

function cleanupFiles(findings: ReturnType<typeof staleBranchFinding>[]) {
  const contents = new Map<string, string>([
    ["aggregate.json", JSON.stringify(aggregateArtifact(findings))],
  ]);
  return {
    contents,
    files: {
      read: async (path: string) => contents.get(path) ?? "",
      write: async (path: string, value: string) => {
        contents.set(path, value);
      },
    },
  };
}

function githubBranchDeletionFetch(branchTips: ReadonlyMap<string, string>) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const repositoryPath = "/repos/ytchou/Formoria";
    if (url.pathname === repositoryPath) {
      return new Response(JSON.stringify({ default_branch: "main" }), {
        status: 200,
      });
    }
    if (url.pathname.startsWith(`${repositoryPath}/branches/`)) {
      return new Response(JSON.stringify({ protected: false }), {
        status: 200,
      });
    }
    if (url.pathname.startsWith(`${repositoryPath}/git/ref/heads/`)) {
      const branch = decodeURIComponent(
        url.pathname.slice(`${repositoryPath}/git/ref/heads/`.length),
      );
      const tipSha = branchTips.get(branch);
      if (!tipSha) return new Response(null, { status: 404 });
      return new Response(
        JSON.stringify({
          object: { sha: tipSha },
          ref: `refs/heads/${branch}`,
        }),
        { status: 200 },
      );
    }
    if (url.pathname === `${repositoryPath}/pulls`) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.pathname.startsWith(`${repositoryPath}/compare/`)) {
      const tipSha = url.pathname
        .slice(`${repositoryPath}/compare/`.length)
        .split("...")[0];
      return new Response(
        JSON.stringify({
          base_commit: { sha: tipSha },
          merge_base_commit: { sha: tipSha },
          status: "ahead",
        }),
        { status: 200 },
      );
    }
    if (
      init?.method === "DELETE" &&
      url.pathname.startsWith(`${repositoryPath}/git/refs/heads/`)
    ) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected GitHub request: ${init?.method} ${url}`);
  });
}

describe("workflow runtime artifacts", () => {
  it("converts link cleanup telemetry into human-owned findings without URLs", () => {
    const artifact = makeLinkArtifact(
      {
        blocked: 0,
        broken: 1,
        checked: 1,
        cleanupRequired: [
          {
            brandId: "brand-1",
            field: "purchase_website",
            url: "https://secret.example/path?token=value",
          },
        ],
        failingRows: [],
        heroBroken: [],
        heroExternal: [],
        ok: 0,
        severity: "warning",
      },
      now,
    );

    expect(artifact.findings).toEqual([
      expect.objectContaining({
        fingerprint: "link:cleanup-required:brand-1:purchase_website",
        mergePolicy: "human",
        source: "link",
      }),
    ]);
    expect(JSON.stringify(artifact)).not.toContain("secret.example");
  });

  it("evaluates deterministic Directory input through the shared policy module", () => {
    const artifact = makeDirectoryArtifact(directoryInput(), now);
    expect(artifact).toMatchObject({
      findings: [],
      routine: "directory-health",
      status: "success",
      version: 1,
    });
    expect(artifact.snapshot).toMatchObject({
      approvedBrands: { approvedTotal: 12 },
    });
  });

  it("schema-validates Claude classifications before building Sentry findings", () => {
    const issue = {
      environment: "production" as const,
      recurrence: {
        eventCount: 2,
        firstSeen: now,
        lastSeen: now,
        userCount: 0,
      },
      rootCauseEvidence: {
        culprit: "src/app.ts",
        exceptionType: "TypeError",
        level: "error",
        message: "Cannot read property",
        platform: "javascript",
        stack: ["src/app.ts:10"],
        tags: {},
      },
      title: "Production TypeError",
    };
    const classification = {
      behaviorChangeRisk: "low",
      changedFiles: ["src/app.ts"],
      confidence: 0.95,
      defectKind: "application",
      fixability: "high",
      mergePolicy: "automatic",
      recommendedAction: "Add the missing guard.",
      recurrence: {
        count: 2,
        evidence: "Two production events.",
        status: "recurring",
      },
      reproducible: true,
      rootCause: "A missing application guard.",
      rootCauseKey: "src-app-missing-guard",
      sensitivePaths: [],
      severity: "medium",
    };

    const artifact = finalizeSentryArtifact(
      {
        candidateIssueCount: 1,
        hasMore: false,
        incidentMode: false,
        issues: [issue],
        requestCount: 1,
      },
      [classification],
      now,
    );
    expect(artifact.findings[0]).toMatchObject({
      mergePolicy: "automatic",
      source: "sentry",
    });
    expect(() =>
      finalizeSentryArtifact(
        {
          candidateIssueCount: 1,
          hasMore: false,
          incidentMode: false,
          issues: [issue],
          requestCount: 1,
        },
        [{ ...classification, confidence: 2 }],
        now,
      ),
    ).toThrow();
  });
});

describe("collect-brand-review", () => {
  const input = {
    mode: "dry-run",
    outputPath: "brand-review.json",
    runAt: now,
    windowHours: 25,
    workflowAttempt: "1",
    workflowRunId: "123",
  };
  const env = {
    HEALTH_AGENT_READER_TOKEN: "reader-token",
    HEALTH_AGENT_WRITER_TOKEN: "writer-token",
    NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
  };

  function brandReviewFiles() {
    const contents = new Map<string, string>();
    return {
      contents,
      files: {
        read: async (path: string) => contents.get(path) ?? "",
        write: async (path: string, value: string) => {
          contents.set(path, value);
        },
      },
    };
  }

  it("produces a successful artifact with findings for recent brand issues", async () => {
    const { contents, files } = brandReviewFiles();
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              description: "English description",
              description_en: null,
              id: "brand-1",
              mit_declared_at: null,
              mit_declared_scope: "all",
              mit_status: "declared",
              mit_verified_at: null,
              name: "Brand One",
              other_urls: JSON.stringify([
                { label: "Profile", url: "https://formoria.com/brand-one" },
              ]),
              purchase_website: null,
              social_facebook: null,
              social_instagram: null,
              social_threads: null,
            },
          ]),
          { status: 200 },
        ),
      ),
    );

    await runWorkflowCommand("collect-brand-review", input, {
      env,
      fetchImplementation,
      files,
    });

    expect(
      JSON.parse(contents.get(input.outputPath) ?? "{}"),
    ).toMatchObject({
      findings: [
        expect.objectContaining({ title: "MIT declared without date" }),
        expect.objectContaining({
          title: "Self-referential formoria.com URL",
        }),
      ],
      routine: "brand-review",
      status: "success",
    });
  });

  it("produces a successful empty artifact when there are no recent edits", async () => {
    const { contents, files } = brandReviewFiles();
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Promise.resolve(new Response(JSON.stringify([]), { status: 200 })),
    );

    await runWorkflowCommand("collect-brand-review", input, {
      env,
      fetchImplementation,
      files,
    });

    expect(
      JSON.parse(contents.get(input.outputPath) ?? "{}"),
    ).toMatchObject({
      findings: [],
      routine: "brand-review",
      status: "success",
    });
  });

  it("writes a failed artifact when the Supabase query fails", async () => {
    const { contents, files } = brandReviewFiles();
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "unavailable" }), {
          status: 500,
        }),
      ),
    );

    await runWorkflowCommand("collect-brand-review", input, {
      env,
      fetchImplementation,
      files,
    });

    expect(
      JSON.parse(contents.get(input.outputPath) ?? "{}"),
    ).toMatchObject({
      failure: "supabase_runtime_request_failed",
      findings: [],
      routine: "brand-review",
      status: "failed",
    });
  });

  it("claims the ledger before completing the live run", async () => {
    const { files } = brandReviewFiles();
    let claimed = false;
    const fetchImplementation = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url.includes("/rest/v1/brands?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith("/rest/v1/rpc/claim_health_agent_run")) {
        claimed = true;
        return new Response(JSON.stringify({ claimed: true }), { status: 200 });
      }
      if (url.endsWith("/rest/v1/rpc/complete_health_agent_run")) {
        expect(claimed).toBe(true);
        return new Response(JSON.stringify(true), { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await runWorkflowCommand(
      "collect-brand-review",
      { ...input, mode: "live", mutate: true },
      { env, fetchImplementation, files },
    );

    const rpcCalls = fetchImplementation.mock.calls.filter(([request]) =>
      String(request).includes("/rest/v1/rpc/"),
    );
    expect(rpcCalls.map(([request]) => String(request))).toEqual([
      "https://db.example/rest/v1/rpc/claim_health_agent_run",
      "https://db.example/rest/v1/rpc/complete_health_agent_run",
    ]);
    expect(JSON.parse(String(rpcCalls[0]?.[1]?.body))).toEqual({
      p_logical_date: "2026-07-22",
      p_requested_run_id: "gha:123/1",
      p_routine: "brand-review",
      p_workflow_attempt: 1,
    });
    expect(JSON.parse(String(rpcCalls[1]?.[1]?.body))).toEqual({
      p_logical_date: "2026-07-22",
      p_requested_run_id: "gha:123/1",
      p_routine: "brand-review",
      p_result: {
        finding_count: 0,
        reviewed_count: 0,
        window_start_iso: "2026-07-20T23:00:00.000Z",
      },
      p_workflow_attempt: 1,
    });
  });

  it.each([
    [{ claimed: false, replay: true }, "brand_review_replay"],
    [{ claimed: false, replay: false }, "brand_review_in_progress"],
  ] as const)(
    "does not complete or deliver when the ledger claim is not granted",
    async (claimResponse, skippedAction) => {
      const { contents, files } = brandReviewFiles();
      const fetchImplementation = vi.fn<typeof fetch>(async (request) => {
        const url = String(request);
        if (url.includes("/rest/v1/brands?")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.endsWith("/rest/v1/rpc/claim_health_agent_run")) {
          return new Response(JSON.stringify(claimResponse), { status: 200 });
        }
        throw new Error(`unexpected request: ${url}`);
      });
      const delivery = {
        agentHub: vi.fn(async () => undefined),
        slack: vi.fn(async () => undefined),
      };

      await runWorkflowCommand(
        "collect-brand-review",
        { ...input, mode: "live", mutate: true },
        { delivery, env, fetchImplementation, files },
      );

      expect(
        JSON.parse(contents.get(input.outputPath) ?? "{}"),
      ).toMatchObject({
        skippedActions: [skippedAction],
        status: "success",
      });
      expect(
        fetchImplementation.mock.calls
          .filter(([request]) => String(request).includes("/rest/v1/rpc/"))
          .map(([request]) => String(request)),
      ).toEqual(["https://db.example/rest/v1/rpc/claim_health_agent_run"]);
      expect(delivery.agentHub).not.toHaveBeenCalled();
      expect(delivery.slack).not.toHaveBeenCalled();
    },
  );

  it("writes a failed artifact when ledger completion is not successful", async () => {
    const { contents, files } = brandReviewFiles();
    const fetchImplementation = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url.includes("/rest/v1/brands?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith("/rest/v1/rpc/claim_health_agent_run")) {
        return new Response(JSON.stringify({ claimed: true }), { status: 200 });
      }
      if (url.endsWith("/rest/v1/rpc/complete_health_agent_run")) {
        return new Response(JSON.stringify(false), { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await runWorkflowCommand(
      "collect-brand-review",
      { ...input, mode: "live", mutate: true },
      { env, fetchImplementation, files },
    );

    expect(
      JSON.parse(contents.get(input.outputPath) ?? "{}"),
    ).toMatchObject({
      failure: "supabase_runtime_request_failed",
      routine: "brand-review",
      status: "failed",
    });
  });

  it("keeps live collection read-only when mutation is disabled", async () => {
    const { contents, files } = brandReviewFiles();
    const fetchImplementation = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url.includes("/rest/v1/brands?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await runWorkflowCommand(
      "collect-brand-review",
      { ...input, mode: "live", mutate: false },
      {
        env: {
          HEALTH_AGENT_READER_TOKEN: "reader-token",
          NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
        },
        fetchImplementation,
        files,
      },
    );

    expect(
      JSON.parse(contents.get(input.outputPath) ?? "{}"),
    ).toMatchObject({
      routine: "brand-review",
      skippedActions: ["brand_review_delivery"],
      status: "success",
    });
    expect(
      fetchImplementation.mock.calls.some(([request]) =>
        String(request).includes("/rest/v1/rpc/"),
      ),
    ).toBe(false);
  });

  it("skips collection and delivery in preflight mode", async () => {
    const { contents, files } = brandReviewFiles();
    const fetchImplementation = vi.fn<typeof fetch>();
    const slack = vi.fn(async () => undefined);

    await runWorkflowCommand(
      "collect-brand-review",
      { ...input, mode: "preflight" },
      {
        delivery: { agentHub: vi.fn(async () => undefined), slack },
        env,
        fetchImplementation,
        files,
      },
    );

    expect(
      JSON.parse(contents.get(input.outputPath) ?? "{}"),
    ).toMatchObject({
      findings: [],
      routine: "brand-review",
      status: "skipped",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(slack).not.toHaveBeenCalled();
  });
});

describe("aggregate-and-deliver runtime", () => {
  it("persists the aggregate result and fails on delivery errors", async () => {
    const contents = new Map<string, string>(
      ["link-checker", "directory-health", "sentry-triage"].map((routine) => [
        `${routine}.json`,
        JSON.stringify({
          collectedAt: now,
          evidence: {},
          failures: [],
          findings: [],
          routine,
          skippedActions: [],
          status: "success",
          version: 1,
        }),
      ]),
    );
    const files = {
      read: async (path: string) => contents.get(path) ?? "",
      write: async (path: string, value: string) => {
        contents.set(path, value);
      },
    };
    const delivery = {
      agentHub: vi.fn(async () => {
        throw new Error("agent hub unavailable");
      }),
      slack: vi.fn(async () => {
        throw new Error("slack unavailable");
      }),
    };

    await expect(
      runAggregateAndDeliver(
        {
          directoryArtifactPath: "directory-health.json",
          linkArtifactPath: "link-checker.json",
          mode: "live",
          outputPath: "aggregate.json",
          runAt: now,
          sentryArtifactPath: "sentry-triage.json",
          workflowAttempt: 1,
          workflowRunId: "123",
        },
        { delivery, files },
      ),
    ).rejects.toThrow("health_delivery_failed");

    expect(JSON.parse(contents.get("aggregate.json") ?? "{}")).toMatchObject({
      deliveryErrors: {
        agentHub: expect.arrayContaining([
          "link-checker",
          "directory-health",
          "sentry-triage",
        ]),
        slack: ["health-digest"],
      },
    });
  });
});

describe("stale branch cleanup runtime", () => {
  const firstTip = "a".repeat(40);
  const secondTip = "b".repeat(40);
  const runtimeInput = {
    aggregateArtifactPath: "aggregate.json",
    mode: "live" as const,
    outputPath: "cleanup-result.json",
    runAt: now,
    runIdentity: "github-actions:123:1",
    workflowAttempt: 1,
    workflowRunId: "123",
  };
  const runtimeEnv = {
    GITHUB_APP_TOKEN: "github-secret-token",
    GITHUB_REPOSITORY: "ytchou/Formoria",
  };

  it("deletes every eligible stale branch in live mode through the GitHub adapter", async () => {
    const findings = [
      staleBranchFinding("merged/first", firstTip),
      staleBranchFinding("merged/second", secondTip),
    ];
    const { contents, files } = cleanupFiles(findings);
    const fetchImplementation = githubBranchDeletionFetch(
      new Map([
        ["merged/first", firstTip],
        ["merged/second", secondTip],
      ]),
    );

    const result = await cleanupStaleBranches(runtimeInput, {
      env: runtimeEnv,
      fetchImplementation,
      files,
    });

    expect(result.outcomes).toEqual([
      {
        branch: "merged/first",
        deletedTipSha: firstTip,
        fingerprint: `directory:stale-branch:${firstTip}`,
        outcome: "deleted",
        recordedTipSha: firstTip,
      },
      {
        branch: "merged/second",
        deletedTipSha: secondTip,
        fingerprint: `directory:stale-branch:${secondTip}`,
        outcome: "deleted",
        recordedTipSha: secondTip,
      },
    ]);
    expect(
      fetchImplementation.mock.calls.filter(
        ([, init]) => init?.method === "DELETE",
      ),
    ).toHaveLength(2);
    expect(contents.get(runtimeInput.outputPath)).not.toContain(
      runtimeEnv.GITHUB_APP_TOKEN,
    );
  });

  it("deletes only exact requested fingerprints in canary mode", async () => {
    const findings = [
      staleBranchFinding("merged/first", firstTip),
      staleBranchFinding("merged/second", secondTip),
    ];
    const { files } = cleanupFiles(findings);
    const fetchImplementation = githubBranchDeletionFetch(
      new Map([
        ["merged/first", firstTip],
        ["merged/second", secondTip],
      ]),
    );

    const result = await cleanupStaleBranches(
      {
        ...runtimeInput,
        canaryFingerprints: [
          `directory:stale-branch:${firstTip.slice(0, -1)}`,
          `directory:stale-branch:${secondTip}`,
        ],
        mode: "canary_fix",
      },
      { env: runtimeEnv, fetchImplementation, files },
    );

    expect(result.outcomes.map(({ fingerprint }) => fingerprint)).toEqual([
      `directory:stale-branch:${secondTip}`,
    ]);
    const deleteCall = fetchImplementation.mock.calls.find(
      ([, init]) => init?.method === "DELETE",
    );
    expect(deleteCall?.[0].toString()).toContain("merged%2Fsecond");
    expect(
      fetchImplementation.mock.calls.filter(
        ([, init]) => init?.method === "DELETE",
      ),
    ).toHaveLength(1);
  });

  it("reports cleanup outcomes to Agent Hub and Slack independently", async () => {
    const { files } = cleanupFiles([
      staleBranchFinding("merged/first", firstTip),
    ]);
    const fetchImplementation = githubBranchDeletionFetch(
      new Map([["merged/first", firstTip]]),
    );
    const agentHub = vi.fn(async () => undefined);
    const slack = vi.fn(async () => undefined);

    const result = await cleanupStaleBranches(runtimeInput, {
      delivery: { agentHub, slack },
      env: runtimeEnv,
      fetchImplementation,
      files,
    });

    expect(agentHub).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fixed: true, merged: false }),
        routine: "health-selfheal",
        source: "github_actions",
      }),
    );
    expect(slack).toHaveBeenCalledWith(
      expect.objectContaining({
        prOutcomes: [
          expect.objectContaining({
            action: "stale_branch_cleanup",
            outcome: "deleted",
            tip_sha: firstTip,
          }),
        ],
      }),
    );
    expect(result.delivery).toEqual({
      agentHub: "fulfilled",
      slack: "fulfilled",
    });
  });

  it("records preflight skips without configuring or invoking GitHub", async () => {
    const { contents, files } = cleanupFiles([
      staleBranchFinding("merged/first", firstTip),
    ]);
    const fetchImplementation = vi.fn<typeof fetch>();

    const result = await cleanupStaleBranches(
      { ...runtimeInput, mode: "preflight" },
      { env: {}, fetchImplementation, files },
    );

    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        branch: "merged/first",
        outcome: "skipped",
        reason: "preflight",
      }),
    ]);
    expect(
      JSON.parse(contents.get(runtimeInput.outputPath) ?? "{}"),
    ).toMatchObject({
      mode: "preflight",
      runIdentity: runtimeInput.runIdentity,
    });
  });

  it("rejects malformed branch evidence before any GitHub request", async () => {
    const malformed = staleBranchFinding("merged/first", firstTip);
    malformed.evidence.currentRemoteTipSha = "not-a-sha";
    const { files } = cleanupFiles([malformed]);
    const fetchImplementation = vi.fn<typeof fetch>();

    await expect(
      cleanupStaleBranches(runtimeInput, {
        env: runtimeEnv,
        fetchImplementation,
        files,
      }),
    ).rejects.toThrow("stale_branch_cleanup_evidence_invalid");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("never sends stale branch cleanup findings to the repair queue", async () => {
    const ordinaryFinding = {
      evidence: {},
      fingerprint: "directory:runtime:repairable",
      mergePolicy: "automatic" as const,
      severity: "medium" as const,
      source: "directory" as const,
      title: "Repairable runtime problem",
    };
    const contents = new Map([
      [
        "aggregate.json",
        JSON.stringify(
          aggregateArtifact([
            staleBranchFinding("merged/first", firstTip),
            ordinaryFinding,
          ]),
        ),
      ],
    ]);
    const enqueue = vi.fn(async () => undefined);

    const result = await enqueueAndClaimWorkflowBatch(
      {
        findingsArtifactPath: "aggregate.json",
        leaseOwner: "github-actions:123:1",
        mode: "live",
        outputPath: "queue-result.json",
      },
      {
        env: { HEALTH_AGENT_ENABLED: "true" },
        files: {
          read: async (path) => contents.get(path) ?? "",
          write: async (path, value) => {
            contents.set(path, value);
          },
        },
        queue: {
          claim: vi.fn(async () => []),
          enqueue,
          hasUnconfirmedAutomatic: vi.fn(async () => true),
        },
      },
    );

    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: ordinaryFinding.fingerprint }),
    );
    expect(enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: `directory:stale-branch:${firstTip}`,
      }),
    );
    expect(result.enqueuedFingerprints).toEqual([ordinaryFinding.fingerprint]);
  });
});

describe("scoped writer RPC", () => {
  it("uses only named PostgREST RPC endpoints and never table writes", async () => {
    const fetchImplementation = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(JSON.stringify([{ id: "row-1" }]), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      },
    );
    const client = createRpcClient(
      { baseUrl: "https://db.example", token: "writer-token" },
      fetchImplementation,
    );

    await client.call("claim_health_fixes", {
      p_lease_owner: "run-1",
      p_merge_policy: "automatic",
    });

    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe("https://db.example/rest/v1/rpc/claim_health_fixes");
    expect(init?.method).toBe("POST");
    expect(JSON.stringify(init)).not.toContain("service_role");
  });

  it("preserves the claimed queue row ID returned by the claim RPC", async () => {
    const queueId = "46591f9f-bbba-4f82-8bee-6b0334f13167";
    const fetchImplementation = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify([
            {
              evidence: { canary: true },
              fingerprint: "directory:canary:github-app-pr",
              id: queueId,
              merge_policy: "automatic",
              source: "directory",
              title: "GitHub App canary repair",
            },
          ]),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
    );
    const dependencies = createWorkflowRuntimeDependencies({
      env: {
        HEALTH_AGENT_WRITER_TOKEN: "writer-token",
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
      },
      fetchImplementation,
    });
    const claim = dependencies.queue?.claim;
    if (!claim) throw new Error("queue_claim_missing");

    const result = await claim("automatic", "github-actions:987654321:1");

    expect(result).toEqual([
      expect.objectContaining({
        claimedFindingId: queueId,
        fingerprint: "directory:canary:github-app-pr",
      }),
    ]);
  });
});

describe("repair result delivery", () => {
  it.each([
    {
      expectedIds: automaticFindingIds,
      expectedStatuses: ["pr_opened"],
      mergePolicy: "automatic" as const,
    },
    {
      expectedIds: humanFindingIds,
      expectedStatuses: ["pr_opened", "awaiting_human"],
      mergePolicy: "human" as const,
    },
  ])(
    "preserves claimed IDs and transitions $mergePolicy repairs through $expectedStatuses",
    async ({ expectedIds, expectedStatuses, mergePolicy }) => {
      const { contents, files } = repairResultFiles();
      const fetchImplementation = transitionFetch();
      const agentHub = vi.fn(async () => undefined);
      const slack = vi.fn(async () => undefined);
      const input = repairResultInput(mergePolicy);

      const result = await deliverRepairResult(input, {
        delivery: { agentHub, slack },
        env: {
          HEALTH_AGENT_WRITER_TOKEN: "writer-token",
          NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
        },
        fetchImplementation,
        files,
      });

      expect(result).toMatchObject({
        agent_hub: "fulfilled",
        claimed_finding_ids: expectedIds,
        merge_policy: mergePolicy,
        slack: "fulfilled",
        status: mergePolicy === "human" ? "awaiting_human" : "pr_opened",
      });
      const transitions = fetchImplementation.mock.calls.map(([, init]) =>
        JSON.parse(String(init?.body)),
      );
      expect(transitions).toHaveLength(
        expectedIds.length * expectedStatuses.length,
      );
      for (const findingId of expectedIds) {
        for (const status of expectedStatuses) {
          expect(transitions).toContainEqual(
            expect.objectContaining({
              p_id: findingId,
              p_new_status: status,
            }),
          );
        }
      }
      expect(agentHub).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: mergePolicy === "human" ? "awaiting_human" : "pr_opened",
          }),
        }),
      );
      expect(slack).toHaveBeenCalledOnce();
      expect(JSON.parse(contents.get(input.outputPath) ?? "{}")).toMatchObject({
        claimed_finding_ids: expectedIds,
        status: mergePolicy === "human" ? "awaiting_human" : "pr_opened",
      });
    },
  );

  it.each(["agentHub", "slack"] as const)(
    "records independent delivery outcomes when %s fails",
    async (failingDelivery) => {
      const { contents, files } = repairResultFiles();
      const agentHub = vi.fn(async () => {
        if (failingDelivery === "agentHub")
          throw new Error("ingest unavailable");
      });
      const slack = vi.fn(async () => {
        if (failingDelivery === "slack") throw new Error("webhook unavailable");
      });
      const input = repairResultInput("automatic");

      await expect(
        deliverRepairResult(input, {
          delivery: { agentHub, slack },
          env: {
            HEALTH_AGENT_WRITER_TOKEN: "writer-token",
            NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
          },
          fetchImplementation: transitionFetch(),
          files,
        }),
      ).rejects.toThrow("repair_result_delivery_failed");

      expect(agentHub).toHaveBeenCalledOnce();
      expect(slack).toHaveBeenCalledOnce();
      const writtenResult = JSON.parse(contents.get(input.outputPath) ?? "{}");
      expect(writtenResult).toMatchObject({
        agent_hub: failingDelivery === "agentHub" ? "rejected" : "fulfilled",
        claimed_finding_ids: automaticFindingIds,
        slack: failingDelivery === "slack" ? "rejected" : "fulfilled",
        status: "pr_opened",
      });
    },
  );
});

describe("repair failure delivery", () => {
  it("moves claimed findings directly to needs_human, syncs Linear, and persists a redacted result", async () => {
    const { contents, files } = repairResultFiles();
    const fetchImplementation = transitionFetch();
    const linearSync = vi.fn(async () => ({
      outcomes: [
        {
          action: "created",
          access_token: "linear-sensitive-token",
          issue_identifier: "ENG-142",
        },
      ],
      tickets: ["ENG-142"],
    }));
    const agentHub = vi.fn(async () => undefined);
    const slack = vi.fn(async () => undefined);
    const input = repairFailureInput();

    const result = await deliverRepairFailure(input, {
      delivery: { agentHub, slack },
      env: {
        HEALTH_AGENT_WRITER_TOKEN: "writer-token",
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
      },
      fetchImplementation,
      files,
      linear: { sync: linearSync },
    });

    const transitions = fetchImplementation.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(transitions).toHaveLength(automaticFindingIds.length);
    for (const findingId of automaticFindingIds) {
      expect(transitions).toContainEqual({
        p_confirmation_data: null,
        p_deployed_at: null,
        p_expected_status: "claimed",
        p_id: findingId,
        p_last_error: "repair_validation_failed_after_two_cycles",
        p_lease_owner: input.leaseOwner,
        p_merge_sha: null,
        p_new_status: "needs_human",
        p_next_attempt_at: null,
        p_pr_number: null,
        p_pr_url: null,
      });
    }
    expect(transitions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ p_new_status: "pr_opened" }),
      ]),
    );
    expect(linearSync).toHaveBeenCalledWith({
      exhaustedAutomationFingerprints: expect.arrayContaining(
        automaticRepairFindings.map(({ fingerprint }) => fingerprint),
      ),
      findings: expect.arrayContaining(
        automaticRepairFindings.map(({ fingerprint }) =>
          expect.objectContaining({ fingerprint }),
        ),
      ),
    });
    expect(agentHub).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          finding_count: automaticRepairFindings.length,
          linear_required: true,
          status: "needs_human",
        }),
      }),
    );
    expect(slack).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: ["repair_validation_failed_after_two_cycles"],
        linearOutcomes: [
          expect.objectContaining({ issue_identifier: "ENG-142" }),
        ],
      }),
    );
    expect(result).toMatchObject({
      agent_hub: "fulfilled",
      claimed_finding_ids: automaticFindingIds,
      merge_policy: "automatic",
      slack: "fulfilled",
      status: "needs_human",
    });
    const persisted = contents.get(input.outputPath) ?? "";
    expect(persisted).toContain("ENG-142");
    expect(persisted).not.toContain("linear-sensitive-token");
    const persistedResult = JSON.parse(persisted);
    expect(persistedResult).toMatchObject({
      agent_hub: "fulfilled",
      claimed_finding_ids: automaticFindingIds,
      linear_outcomes: [{ action: "created", issue_identifier: "ENG-142" }],
      merge_policy: "automatic",
      slack: "fulfilled",
      status: "needs_human",
    });
    expect(persistedResult.linear_outcomes[0]).not.toHaveProperty(
      "access_token",
    );
  });

  it.each(["agentHub", "slack"] as const)(
    "attempts both repair-failure deliveries and records outcomes when %s fails",
    async (failingDelivery) => {
      const { contents, files } = repairResultFiles();
      const agentHub = vi.fn(async () => {
        if (failingDelivery === "agentHub")
          throw new Error("ingest unavailable");
      });
      const slack = vi.fn(async () => {
        if (failingDelivery === "slack") throw new Error("webhook unavailable");
      });
      const input = repairFailureInput();

      await expect(
        deliverRepairFailure(input, {
          delivery: { agentHub, slack },
          env: {
            HEALTH_AGENT_WRITER_TOKEN: "writer-token",
            NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
          },
          fetchImplementation: transitionFetch(),
          files,
          linear: { sync: vi.fn(async () => ({ outcomes: [] })) },
        }),
      ).rejects.toThrow("repair_failure_delivery_failed");

      expect(agentHub).toHaveBeenCalledOnce();
      expect(slack).toHaveBeenCalledOnce();
      expect(JSON.parse(contents.get(input.outputPath) ?? "{}")).toMatchObject({
        agent_hub: failingDelivery === "agentHub" ? "rejected" : "fulfilled",
        claimed_finding_ids: automaticFindingIds,
        slack: failingDelivery === "slack" ? "rejected" : "fulfilled",
        status: "needs_human",
      });
    },
  );
});

describe("health-agent migration contract", () => {
  it("exposes catalog-backed Directory evidence only to the reader role", async () => {
    const migration = await readFile(
      "supabase/migrations/20260722200000_github_health_agent_foundations.sql",
      "utf8",
    );

    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION read_health_directory_database_evidence()",
    );
    expect(migration).toContain("FROM pg_catalog.pg_stat_activity");
    expect(migration).toContain("FROM pg_catalog.pg_stat_user_tables");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION read_health_directory_database_evidence() FROM PUBLIC;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION read_health_directory_database_evidence() TO health_agent_reader, service_role;",
    );
  });
});

describe("default runtime dependencies", () => {
  it("collects approved Directory data and prefers the upstream link artifact", async () => {
    const fetchImplementation = vi.fn(
      async (...args: Parameters<typeof fetch>) => {
        const url = String(args[0]);
        if (url.includes("/rest/v1/brands?")) {
          return new Response(
            JSON.stringify([
              {
                approved_at: now,
                created_at: now,
                description: "Approved brand description with enough detail.",
                hero_image_url: "https://cdn.example/hero.png",
                id: "approved-brand",
              },
            ]),
            { status: 200 },
          );
        }
        if (url.includes("/rest/v1/link_check_results?")) {
          return new Response(
            JSON.stringify([
              {
                brand_id: "approved-brand",
                failure_dates: ["2026-07-20"],
                field: "purchase_website",
                id: "stored-link",
                last_status_code: 200,
              },
              {
                brand_id: "unapproved-brand",
                failure_dates: ["2026-07-20"],
                field: "purchase_website",
                id: "unapproved-link",
                last_status_code: 500,
              },
            ]),
            { status: 200 },
          );
        }
        if (url.includes("/rest/v1/health_snapshots?")) {
          return new Response(
            JSON.stringify([
              {
                id: "snapshot-1",
                metrics: {
                  database: {
                    connections: { maximum: 100, total: 10 },
                  },
                },
                snapshot_date: "2026-07-22",
              },
            ]),
            { status: 200 },
          );
        }
        if (
          url.includes("/rest/v1/rpc/read_health_directory_database_evidence")
        ) {
          return new Response(
            JSON.stringify({
              activeQueries: [],
              connections: { maximum: 100, total: 12 },
              deadTupleSnapshots: [{ snapshotDate: "2026-07-22", tables: [] }],
              indexConcerns: [],
            }),
            { status: 200 },
          );
        }
        if (url === "https://api.github.com/graphql") {
          return new Response(
            JSON.stringify({
              data: {
                repository: {
                  defaultBranchRef: {
                    name: "main",
                    target: { oid: "a".repeat(40) },
                  },
                  refs: {
                    nodes: [
                      {
                        associatedPullRequests: {
                          nodes: [
                            {
                              headRefOid: "b".repeat(40),
                              mergedAt: "2026-06-01T00:00:00.000Z",
                              state: "MERGED",
                            },
                          ],
                        },
                        branchProtectionRule: null,
                        name: "merged-old-branch",
                        target: {
                          committedDate: "2026-06-01T00:00:00.000Z",
                          oid: "b".repeat(40),
                        },
                      },
                    ],
                  },
                  vulnerabilityAlerts: {
                    nodes: [
                      {
                        number: 17,
                        securityVulnerability: {
                          firstPatchedVersion: { identifier: "2.1.1" },
                          package: { name: "vulnerable-package" },
                          severity: "HIGH",
                        },
                      },
                    ],
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected request: ${url}`);
      },
    );
    const dependencies = createWorkflowRuntimeDependencies({
      env: {
        GITHUB_REPOSITORY: "ytchou/Formoria",
        GITHUB_TOKEN: "github-token",
        HEALTH_AGENT_READER_TOKEN: "reader-token",
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
      },
      fetchImplementation,
    });
    dependencies.isAncestor = vi.fn(async () => true);
    const link = makeLinkArtifact(
      {
        blocked: 0,
        broken: 1,
        checked: 1,
        cleanupRequired: [],
        failingRows: [
          {
            brandId: "approved-brand",
            failureDates: ["2026-07-20"],
            field: "purchase_website",
            internalStorage: false,
            recordId: "artifact-link",
            statusCode: 500,
          },
        ],
        heroBroken: [],
        heroExternal: [],
        ok: 0,
        severity: "warning",
      },
      now,
    );
    const directory = await dependencies.collectors?.directory?.({
      artifactPath: "directory-evidence.json",
      link,
      mode: "live",
    });

    expect(directory).toMatchObject({
      approvedBrands: { totalApproved: 1 },
      branches: [
        expect.objectContaining({
          branchRef: "merged-old-branch",
          tipIsAncestorOfMain: true,
        }),
      ],
      dependabot: [
        expect.objectContaining({
          alertId: "17",
          packageName: "vulnerable-package",
          severity: "high",
          versionImpact: "unknown",
        }),
      ],
      links: [{ brandId: "approved-brand", recordId: "artifact-link" }],
    });
    expect(JSON.stringify(directory)).not.toContain("unapproved-brand");
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });

  it("wires real delivery, Linear, and queue adapters by default", () => {
    const dependencies = createWorkflowRuntimeDependencies({
      env: {},
      fetchImplementation: vi.fn(),
    });

    expect(dependencies.collectors?.directory).toEqual(expect.any(Function));
    expect(dependencies.delivery?.agentHub).toEqual(expect.any(Function));
    expect(dependencies.delivery?.slack).toEqual(expect.any(Function));
    expect(dependencies.linear).toEqual(expect.any(Function));
    expect(dependencies.queue?.claim).toEqual(expect.any(Function));
    expect(dependencies.queue?.enqueue).toEqual(expect.any(Function));
    expect(dependencies.queue?.hasUnconfirmedAutomatic).toEqual(
      expect.any(Function),
    );
  });
});
