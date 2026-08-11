import { describe, expect, it, vi } from "vitest";

import type { HealthFinding, MergePolicy } from "./contracts";
import type { RepairFinding } from "./repair";
import { partitionRepairBatch } from "./repair";
import {
  HEALTH_AGENT_CANARY_FINGERPRINT,
  HEALTH_AGENT_COMMANDS,
  HEALTH_ROUTINES,
  aggregateAndDeliver,
  buildLinkHealthRequest,
  buildPrResultEnvelope,
  collectDirectoryArtifact,
  collectSentryArtifact,
  createRoutineEnvelope,
  createRepairPullRequest,
  enqueueAndClaimPolicyBatches,
  repairClaimLimit,
  enqueueAndClaimBatch,
  failedCollectorArtifact,
  internalErrorCode,
  loadCollectorArtifact,
  mutationPolicy,
  redactForAudit,
  writeRedactedJson,
  type CollectorArtifact,
  type JsonFileStore,
  type SlackDigestInput,
} from "./orchestrator";

const runAt = "2026-07-21T23:05:00.000Z";
const enabled = {
  HEALTH_AGENT_ENABLED: "true",
  HEALTH_AUTOFIX_ENABLED: "true",
};

function files(initial: Record<string, unknown> = {}) {
  const values = new Map(
    Object.entries(initial).map(([path, value]) => [
      path,
      JSON.stringify(value),
    ]),
  );
  const store: JsonFileStore = {
    read: async (path) => {
      const value = values.get(path);
      if (value === undefined) throw new Error("missing");
      return value;
    },
    write: async (path, value) => {
      values.set(path, value);
    },
  };
  return { store, values };
}

function finding(
  fingerprint: string,
  mergePolicy: MergePolicy = "automatic",
  source: HealthFinding["source"] = "sentry",
): HealthFinding {
  return {
    // Repairable by default: a claim is only ever spent on findings with
    // tracked changedFiles, so a fixture without them is claimed by nothing and
    // silently turns every claim-mechanics assertion into a no-op. Tests about
    // unrepairable work opt out with an explicit `changedFiles: []`.
    changedFiles: ["src/app.ts"],
    evidence: { frame: "src/app.ts:10", rootCauseKey: fingerprint },
    fingerprint,
    ...(mergePolicy === "human" ? { humanReason: "Review required" } : {}),
    mergePolicy,
    severity: mergePolicy === "human" ? "high" : "medium",
    source,
    title: `Finding ${fingerprint}`,
  };
}

function artifact(
  routine: CollectorArtifact["routine"],
  findings: HealthFinding[] = [],
  overrides: Partial<CollectorArtifact> = {},
): CollectorArtifact {
  return {
    collectedAt: runAt,
    evidence: { collector: routine },
    failures: [],
    findings,
    routine,
    skippedActions: [],
    status: "success",
    version: 1,
    ...overrides,
  };
}

function fixtures(overrides: Record<string, unknown> = {}) {
  return files({
    cron: artifact("cron-health"),
    directory: artifact("directory-health"),
    link: artifact("link-checker"),
    quality: artifact("quality-health"),
    sentry: artifact("sentry-triage"),
    ...overrides,
  });
}

const paths = {
  "cron-health": "cron",
  "directory-health": "directory",
  "link-checker": "link",
  "quality-health": "quality",
  "sentry-triage": "sentry",
} as const;

const aggregateInput = {
  artifactPaths: paths,
  mode: "live" as const,
  runAt,
  workflowAttempt: 2,
  workflowRunId: "9912",
};

describe("artifact and envelope contracts", () => {
  it("synthesizes failed results for missing or invalid collector artifacts", async () => {
    const { store } = files({ invalid: { routine: "growth-pulse" } });
    await expect(
      loadCollectorArtifact("link-checker", "missing", runAt, store),
    ).resolves.toMatchObject({ routine: "link-checker", status: "failed" });
    await expect(
      loadCollectorArtifact("sentry-triage", "invalid", runAt, store),
    ).resolves.toMatchObject({
      failures: ["Error:collector_artifact_unavailable"],
      routine: "sentry-triage",
      status: "failed",
    });
  });

  it("puts the specific reason in failures, not a fixed string", async () => {
    // Regression: `failedCollectorArtifact` hardcoded
    // failures: ["collector_artifact_unavailable"] while accepting a `reason`
    // it only wrote to `.failure`. The run report and the Stage 5 gate read the
    // array, so every distinct collector failure looked identical (DEV-1424).
    const artifact = failedCollectorArtifact(
      "sentry-triage",
      runAt,
      "sentry_collection_issues_invalid",
    );
    expect(artifact.failures).toEqual(["sentry_collection_issues_invalid"]);
    expect(artifact.failure).toBe("sentry_collection_issues_invalid");
  });

  it("surfaces internal failure codes but never arbitrary error text", () => {
    // Our own throws use bare snake_case codes and should stay readable.
    expect(internalErrorCode(new Error("sentry_collection_failed"))).toBe(
      "sentry_collection_failed",
    );
    // Anything else may carry untrusted upstream content (URLs, tokens) and
    // must fall back to the error's class instead of its message.
    expect(
      internalErrorCode(new Error("fetch failed: https://x.io/?token=abc123")),
    ).toBe("Error");
    expect(internalErrorCode(new TypeError("Cannot read x of undefined"))).toBe(
      "TypeError",
    );
    expect(internalErrorCode("not an error")).toBe("operation_failed");
  });

  it("makes Growth Pulse and traffic correlation impossible by command and routine", () => {
    expect(HEALTH_ROUTINES).toEqual([
      "link-checker",
      "directory-health",
      "sentry-triage",
      "quality-health",
      "cron-health",
    ]);
    expect(HEALTH_AGENT_COMMANDS.join(" ")).not.toMatch(
      /growth|posthog|traffic/i,
    );
  });

  it("uses unique workflow-attempt-routine source IDs and a Taipei date", () => {
    const envelopes = HEALTH_ROUTINES.map((routine) =>
      createRoutineEnvelope({
        artifact: artifact(routine),
        runAt,
        workflowAttempt: 2,
        workflowRunId: "9912",
      }),
    );
    expect(envelopes.map(({ source_run_id }) => source_run_id)).toEqual(
      HEALTH_ROUTINES.map(
        (routine) => `github-actions:9912:attempt-2:${routine}`,
      ),
    );
    expect(
      envelopes.every(
        (envelope) =>
          envelope.date === "2026-07-22" &&
          envelope.source === "github_actions" &&
          envelope.data.notification_owner === "github_actions",
      ),
    ).toBe(true);
  });
});

describe("collector commands", () => {
  it("constructs a dry-run link request without carrying the origin secret", () => {
    const request = buildLinkHealthRequest({
      mode: "preflight",
      originSecret: "origin-secret",
      railwayUrl: "https://railway.example",
      workflowAttempt: 2,
      workflowRunId: "9912",
    });

    expect(request).toEqual({
      body: {
        dry_run: true,
        run_identity: "9912:attempt-2",
        workflow_attempt: 2,
      },
      headers: { "content-type": "application/json" },
      method: "POST",
      url: "https://railway.example/api/cron/link-health",
    });
    expect(JSON.stringify(request)).not.toContain("origin-secret");
  });

  it("writes a validated Sentry collector artifact through the injected provider", async () => {
    const { store, values } = files();
    const collector = vi.fn(async () =>
      artifact("sentry-triage", [], {
        snapshot: {
          rawSentry: { secret: "must-not-write" },
          requestCount: 2,
        },
      }),
    );

    const result = await collectSentryArtifact(
      {
        mode: "live",
        outputPath: "sentry",
        runAt,
      },
      { collectors: { sentry: collector }, files: store },
    );

    expect(result).toMatchObject({
      collectedAt: runAt,
      routine: "sentry-triage",
      status: "success",
      version: 1,
    });
    expect(collector).toHaveBeenCalledWith({
      artifactPath: "sentry",
      mode: "live",
    });
    expect(values.get("sentry")).not.toContain("must-not-write");
  });

  it("runs Directory collection only after a successful link artifact", async () => {
    const link = artifact("link-checker");
    const { store, values } = files({ link });
    const collector = vi.fn(
      async ({ link: upstream }: { link: CollectorArtifact }) =>
        artifact("directory-health", [], {
          snapshot: { upstreamRoutine: upstream.routine },
        }),
    );

    const result = await collectDirectoryArtifact(
      {
        collector,
        linkArtifactPath: "link",
        mode: "live",
        outputPath: "directory",
        runAt,
      },
      { files: store },
    );

    expect(result).toMatchObject({
      collectedAt: runAt,
      routine: "directory-health",
      status: "success",
    });
    expect(collector).toHaveBeenCalledWith({
      artifactPath: "directory",
      link: expect.objectContaining({ routine: "link-checker" }),
      mode: "live",
    });
    expect(values.get("directory")).toContain("upstreamRoutine");

    const blockedCollector = vi.fn(async () => artifact("directory-health"));
    const blocked = await collectDirectoryArtifact(
      {
        collector: blockedCollector,
        linkArtifactPath: "missing-link",
        mode: "live",
        outputPath: "blocked-directory",
        runAt,
      },
      { files: store },
    );
    expect(blocked).toMatchObject({
      failure: "upstream_link_artifact_failed",
      routine: "directory-health",
      status: "failed",
    });
    expect(blockedCollector).not.toHaveBeenCalled();
  });

  it("builds a redacted PR result envelope and suppresses preflight status", () => {
    const envelope = buildPrResultEnvelope({
      mode: "preflight",
      prUrl: "https://github.example/pr/42?token=secret",
      result: {
        findings: [
          {
            changedFiles: ["src/cart.ts"],
            fingerprint: "sentry:issue:42",
            source: "sentry",
            status: "ready_to_merge",
          },
        ],
        merged: false,
        prNumber: 42,
        status: "opened",
      },
      runAt,
      workflowAttempt: 2,
      workflowRunId: "9912",
    });

    expect(envelope).toMatchObject({
      date: "2026-07-22",
      project: "formoria",
      routine: "health-selfheal",
      source: "github_actions",
      source_run_id: "github-actions:9912:attempt-2:health-selfheal",
      status: "skipped",
      version: 1,
    });
    expect(envelope.data.notification_owner).toBe("github_actions");
    expect(JSON.stringify(envelope)).not.toContain("github.example");
  });

  it("suppresses pull request creation in preflight", async () => {
    const createPullRequest = vi.fn(async () => ({ number: 42 }));
    const result = await createRepairPullRequest(
      {
        batch: partitionRepairBatch([]).automatic,
        mode: "preflight",
      },
      { createPullRequest },
      enabled,
    );

    expect(result).toEqual({ reason: "preflight", status: "skipped" });
    expect(createPullRequest).not.toHaveBeenCalled();
  });
});

describe("aggregate and deliver", () => {
  it("defers all user-facing delivery until terminal reporting", async () => {
    const { store } = fixtures();
    const agentHub = vi.fn(async () => undefined);
    const slack = vi.fn(async () => undefined);

    const result = await aggregateAndDeliver(
      { ...aggregateInput, deliver: false },
      { delivery: { agentHub, slack }, files: store },
      enabled,
    );

    expect(agentHub).not.toHaveBeenCalled();
    expect(slack).not.toHaveBeenCalled();
    expect(result.deliveries).toEqual([]);
    expect(result.deliveryErrors).toEqual({ agentHub: [], slack: [] });
  });

  it("delivers exactly one envelope per routine and one compact all-clear", async () => {
    const { store } = fixtures();
    const agentHub = vi.fn(async (value: { routine: string }) => {
      void value;
    });
    const slack = vi.fn(async (report: SlackDigestInput) => {
      void report;
    });
    const result = await aggregateAndDeliver(
      aggregateInput,
      { delivery: { agentHub, slack }, files: store },
      enabled,
    );

    expect(agentHub).toHaveBeenCalledTimes(HEALTH_ROUTINES.length);
    expect(agentHub.mock.calls.map(([value]) => value.routine)).toEqual(
      HEALTH_ROUTINES,
    );
    expect(slack).toHaveBeenCalledWith({
      actionableFindings: [],
      failures: [],
      linearOutcomes: [],
      prOutcomes: [],
      skippedActions: [],
    });
    expect(result.slackAllClear).toBe(true);
  });

  it("attempts Slack independently after every Agent Hub delivery fails", async () => {
    const { store } = fixtures();
    const agentHub = vi.fn(async (value: { routine: string }) => {
      void value;
      return Promise.reject(new Error("offline"));
    });
    const slack = vi.fn(async (report: SlackDigestInput) => {
      void report;
      return Promise.reject(new Error("offline"));
    });
    const result = await aggregateAndDeliver(
      aggregateInput,
      { delivery: { agentHub, slack }, files: store },
      enabled,
    );

    expect(agentHub).toHaveBeenCalledTimes(HEALTH_ROUTINES.length);
    expect(slack).toHaveBeenCalledTimes(1);
    expect(result.deliveryErrors).toEqual({
      agentHub: [...HEALTH_ROUTINES],
      slack: ["health-digest"],
    });
  });

  it("includes a failed brand-review artifact in aggregate notifications", async () => {
    const { store } = fixtures({
      "brand-review": {
        collectedAt: runAt,
        evidence: {},
        failure: "brand_review_query_failed",
        failures: ["brand_review_query_failed"],
        findings: [],
        routine: "brand-review",
        skippedActions: [],
        status: "failed",
        version: 1,
      },
    });
    const slack = vi.fn(async (report: SlackDigestInput) => {
      void report;
    });

    const result = await aggregateAndDeliver(
      { ...aggregateInput, brandReviewArtifactPath: "brand-review" },
      { delivery: { agentHub: async () => undefined, slack }, files: store },
      enabled,
    );

    expect(result.envelopes).toHaveLength(HEALTH_ROUTINES.length);
    expect(slack).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          { failure: "brand_review_query_failed", routine: "brand-review" },
        ]),
      }),
    );
  });

  // The aggregate stage runs before enqueue-and-claim, so it cannot know which
  // findings have never been ticketed. deliverFinalHealthReport is the sole
  // Linear writer; this stage only forwards outcomes it was handed.
  it("never writes Linear from the aggregate stage and still reports every finding in Slack", async () => {
    const automatic = finding("sentry:auto");
    const exhausted = finding("sentry:exhausted");
    const human = finding("directory:human", "human", "directory");
    const { store } = fixtures({
      directory: artifact("directory-health", [human], {
        failures: ["query failed"],
        skippedActions: ["cleanup human-owned"],
      }),
      sentry: artifact("sentry-triage", [automatic, exhausted]),
    });
    const linear = vi.fn(
      async (input: { findings: readonly HealthFinding[] }) => {
        void input;
        return {
          outcomes: [{ action: "created", fingerprint: human.fingerprint }],
          tickets: ["FOR-88"],
        };
      },
    );
    const slack = vi.fn(async (report: SlackDigestInput) => {
      void report;
    });

    const result = await aggregateAndDeliver(
      {
        ...aggregateInput,
        exhaustedAutomationFingerprints: [exhausted.fingerprint],
        prOutcomes: [{ pr: 123, status: "opened" }],
      },
      {
        delivery: { agentHub: async () => undefined, slack },
        files: store,
        linear: { sync: linear },
      },
      enabled,
    );

    expect(linear).not.toHaveBeenCalled();
    expect(slack.mock.calls[0]?.[0]).toMatchObject({
      actionableFindings: expect.arrayContaining([human, automatic, exhausted]),
      failures: expect.arrayContaining([
        { failure: "query failed", routine: "directory-health" },
      ]),
      linearOutcomes: [],
      prOutcomes: [{ pr: 123, status: "opened" }],
      skippedActions: expect.arrayContaining([
        { action: "cleanup human-owned", routine: "directory-health" },
      ]),
    });
    expect(
      result.envelopes.every(
        ({ tickets_created }) => tickets_created.length === 0,
      ),
    ).toBe(true);
  });

  it("does not sync Linear in preflight and reports no Linear skip", async () => {
    const human = finding("directory:human", "human", "directory");
    const { store } = fixtures({
      directory: artifact("directory-health", [human]),
    });
    const linear = vi.fn(
      async (input: { findings: readonly HealthFinding[] }) => {
        void input;
        return { outcomes: [] };
      },
    );
    const slack = vi.fn(async (report: SlackDigestInput) => {
      void report;
    });

    await aggregateAndDeliver(
      { ...aggregateInput, mode: "preflight" },
      {
        delivery: { agentHub: async () => undefined, slack },
        files: store,
        linear: { sync: linear },
      },
      enabled,
    );
    expect(linear).not.toHaveBeenCalled();
    expect(slack.mock.calls[0]?.[0]?.skippedActions).not.toContainEqual({
      action: "linear",
      reason: "mutations_disabled",
    });
  });
});

describe("queue mutation gates", () => {
  it("suppresses queue enqueue and claims during preflight", async () => {
    const enqueue = vi.fn(async () => undefined);
    const claim = vi.fn(async () => []);
    expect(mutationPolicy("preflight", enabled)).toEqual({
      autofix: false,
      business: false,
    });
    const result = await enqueueAndClaimBatch(
      {
        findings: [finding("sentry:one")],
        leaseOwner: "run-1",
        mode: "preflight",
      },
      { claim, enqueue },
      enabled,
    );
    expect(result.suppressed).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("enqueues live findings without claiming them when autofix is disabled", async () => {
    const enqueue = vi.fn(async () => undefined);
    const claim = vi.fn(async () => []);
    const result = await enqueueAndClaimBatch(
      {
        findings: [finding("directory:manager-review", "human", "directory")],
        leaseOwner: "run-report-only",
        mode: "live",
      },
      { claim, enqueue },
      {
        HEALTH_AGENT_ENABLED: "true",
        HEALTH_AUTOFIX_ENABLED: "false",
      },
    );

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(claim).not.toHaveBeenCalled();
    expect(result.enqueuedFingerprints).toEqual(["directory:manager-review"]);
    expect(result.skippedActions).toEqual([
      "claim",
      "pull_request",
      "autofix_disabled",
    ]);
  });

  it("enqueues without a cap, claims both policies for one manager batch, and excludes late findings", async () => {
    const automatic = Array.from({ length: 35 }, (_, index) =>
      finding(`sentry:auto-${index}`),
    );
    const human = Array.from({ length: 27 }, (_, index) =>
      finding(`directory:human-${index}`, "human", "directory"),
    );
    const claims: Record<MergePolicy, RepairFinding[]> = {
      automatic: automatic as RepairFinding[],
      human: human as RepairFinding[],
    };
    const enqueue = vi.fn(async () => undefined);
    // Honor the requested scope the way the real claim RPC does — returning
    // rows that were never requested trips the out-of-scope guard, which is
    // covered by its own test.
    const claim = vi.fn(
      async (
        policy: MergePolicy,
        _leaseOwner: string,
        fingerprints: readonly string[],
      ) =>
        claims[policy].filter(({ fingerprint }) =>
          fingerprints.includes(fingerprint),
        ),
    );
    const result = await enqueueAndClaimBatch(
      {
        findings: [...automatic, ...human],
        leaseOwner: "run-2",
        mode: "live",
      },
      {
        claim,
        enqueue,
      },
      enabled,
    );

    // Enqueue stays uncapped — every finding still reaches the queue.
    expect(enqueue).toHaveBeenCalledTimes(62);

    // DEV-1428: the *claim* is now capped. This test previously asserted all 35
    // automatic and all 27 human fingerprints were claimed in one run, which is
    // the behavior that blew MAX_RESULT_BYTES and left queue.json unwritten.
    // The cap is global and severity-ordered, and `finding()` makes human
    // findings `high` and automatic `medium` — so the 27 human findings consume
    // the default budget of 25 and no automatic work is claimed this run. The
    // remainder stays queued for the following run.
    // Ties within a severity break on fingerprint, so the truncated claim is
    // deterministic across runs (lexicographic, not the numeric order these
    // fixture names suggest).
    const expectedHuman = human
      .map(({ fingerprint }) => fingerprint)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 25);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith("human", "run-2", expectedHuman);
    expect(result.human.findings).toHaveLength(25);
    expect(result.automatic.findings).toHaveLength(0);
    expect(result.skippedActions).toContain("claim_limit:25/62");
    claims.automatic.push(finding("sentry:late") as RepairFinding);
    expect(result.automatic.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fingerprint: "sentry:late" }),
      ]),
    );
  });

  it("claims human work independently of outstanding automatic work", async () => {
    const human = [
      finding("directory:human", "human", "directory") as RepairFinding,
    ];
    const claim = vi.fn(async (policy: MergePolicy) =>
      policy === "automatic" ? [] : human,
    );
    const result = await enqueueAndClaimBatch(
      {
        findings: human,
        leaseOwner: "run-human",
        mode: "live",
      },
      {
        claim,
        enqueue: async () => undefined,
      },
      enabled,
    );
    expect(result.automatic.findings).toHaveLength(0);
    expect(result.human.findings).toHaveLength(1);
    expect(claim.mock.calls).toEqual([
      ["human", "run-human", ["directory:human"]],
    ]);

    claim.mockClear();
    const blocked = await enqueueAndClaimBatch(
      {
        findings: human,
        leaseOwner: "run-blocked",
        mode: "live",
      },
      {
        claim,
        enqueue: async () => undefined,
      },
      enabled,
    );
    expect(blocked.human.findings).toHaveLength(1);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith("human", "run-blocked", [
      "directory:human",
    ]);
  });

  it("classifies lifecycle through the production queue adapter", async () => {
    const findings = [
      finding("directory:new", "human", "directory"),
      finding("directory:ongoing", "human", "directory"),
      finding("directory:regressed", "human", "directory"),
    ];
    const listFingerprintStates = vi.fn(async () => [
      { fingerprint: "directory:ongoing", status: "needs_human" },
      { fingerprint: "directory:regressed", status: "fixed" },
    ]);
    const operationOrder: string[] = [];
    const reconcileFingerprintLifecycle = vi.fn(async () => {
      operationOrder.push("reconcile");
      return {
        failedVerificationFingerprints: ["directory:still-broken"],
        fixedFingerprints: ["directory:resolved"],
      };
    });

    const result = await enqueueAndClaimBatch(
      {
        findings,
        leaseOwner: "run-lifecycle",
        mode: "live",
        completedSources: ["directory"],
      },
      {
        claim: async () => [],
        enqueue: async () => void operationOrder.push("enqueue"),
        listFingerprintStates,
        reconcileFingerprintLifecycle,
      },
      enabled,
    );

    expect(listFingerprintStates).toHaveBeenCalledWith([
      "directory:new",
      "directory:ongoing",
      "directory:regressed",
    ]);
    expect(result.lifecycle).toEqual({ new: 1, ongoing: 1, regressed: 1 });
    expect(result.lifecycleFingerprints).toEqual({
      new: ["directory:new"],
      ongoing: ["directory:ongoing"],
      regressed: ["directory:regressed"],
    });
    expect(reconcileFingerprintLifecycle).toHaveBeenCalledWith(
      ["directory:new", "directory:ongoing", "directory:regressed"],
      ["directory"],
    );
    expect(result.verifiedFixedFingerprints).toEqual(["directory:resolved"]);
    expect(result.failedVerificationFingerprints).toEqual([
      "directory:still-broken",
    ]);
    expect(operationOrder).toEqual([
      "enqueue",
      "enqueue",
      "enqueue",
      "reconcile",
    ]);
  });

  it("claims both policies at the database queue boundary", async () => {
    const automatic = finding("sentry:auto") as RepairFinding;
    const human = finding(
      "directory:human",
      "human",
      "directory",
    ) as RepairFinding;
    const claim = vi.fn(async (policy: MergePolicy) =>
      policy === "automatic" ? [automatic] : [human],
    );
    const result = await enqueueAndClaimPolicyBatches(
      {
        findings: [automatic, human],
        leaseOwner: "run-database",
        mode: "live",
      },
      {
        database: {
          claimFindings: claim,
          enqueueFindings: async () => undefined,
        },
      },
      enabled,
    );

    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenCalledWith("automatic", "run-database", [
      "sentry:auto",
    ]);
    expect(claim).toHaveBeenCalledWith("human", "run-database", [
      "directory:human",
    ]);
    expect(result.automatic.findings).toHaveLength(1);
    expect(result.human.findings).toHaveLength(1);
  });

  it("re-arms the canary before enqueueing so canary_fix can rehearse", async () => {
    // DEV-1430: enqueue_health_fix upserts while a row is in any live status,
    // and the canary settled on `deployed` — so it was only ever updated in
    // place, never returned to `pending`, and canary_fix claimed nothing from
    // 2026-07-27 onward. Re-arm has to happen before the enqueue.
    const calls: string[] = [];
    const rearmCanary = vi.fn(async (fingerprint: string) => {
      calls.push(`rearm:${fingerprint}`);
    });
    const enqueue = vi.fn(async () => {
      calls.push("enqueue");
    });

    await enqueueAndClaimPolicyBatches(
      {
        canaryFingerprints: [HEALTH_AGENT_CANARY_FINGERPRINT],
        findings: [],
        leaseOwner: "run-canary",
        mode: "canary_fix",
      },
      { queue: { claim: async () => [], enqueue, rearmCanary } },
      enabled,
    );

    expect(rearmCanary).toHaveBeenCalledWith(HEALTH_AGENT_CANARY_FINGERPRINT);
    expect(calls[0]).toBe(`rearm:${HEALTH_AGENT_CANARY_FINGERPRINT}`);
    expect(calls.indexOf("enqueue")).toBeGreaterThan(0);
  });

  it("still runs the canary rehearsal when re-arming fails", async () => {
    // A rehearsal that cannot re-arm should report and continue, not abort the
    // queue stage — the failure is worth surfacing, not worth losing the run.
    const rearmCanary = vi.fn(async () => {
      throw new Error("rearm_unavailable");
    });

    const result = await enqueueAndClaimPolicyBatches(
      {
        canaryFingerprints: [HEALTH_AGENT_CANARY_FINGERPRINT],
        findings: [],
        leaseOwner: "run-canary",
        mode: "canary_fix",
      },
      {
        queue: { claim: async () => [], enqueue: async () => undefined, rearmCanary },
      },
      enabled,
    );

    expect(
      result.skippedActions.some((action) => action.startsWith("canary_rearm:")),
    ).toBe(true);
  });

  it("never re-arms the canary outside canary_fix mode", async () => {
    // The re-arm resets attempt_count, so it must not touch live runs.
    const rearmCanary = vi.fn(async () => undefined);

    await enqueueAndClaimPolicyBatches(
      {
        canaryFingerprints: [HEALTH_AGENT_CANARY_FINGERPRINT],
        findings: [finding("sentry:one")],
        leaseOwner: "run-live",
        mode: "live",
      },
      {
        queue: { claim: async () => [], enqueue: async () => undefined, rearmCanary },
      },
      enabled,
    );

    expect(rearmCanary).not.toHaveBeenCalled();
  });

  it("caps how many findings one run claims, most severe first", async () => {
    // DEV-1428: with autofix finally enabled, the claim path serialized every
    // eligible finding into the queue result and blew MAX_RESULT_BYTES, so
    // queue.json was never written and every downstream step failed on the
    // missing file. A run opens at most one repair PR, so claiming the whole
    // backlog was never useful anyway.
    const findings = [
      ...Array.from({ length: 40 }, (_, i) => ({
        ...finding(`sentry:low-${String(i).padStart(3, "0")}`),
        severity: "low" as const,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        ...finding(`sentry:crit-${i}`),
        severity: "critical" as const,
      })),
    ];
    const claim = vi.fn(async () => []);
    const enqueue = vi.fn(async () => undefined);

    const result = await enqueueAndClaimPolicyBatches(
      { findings, leaseOwner: "run-cap", mode: "live" },
      {
        database: { claimFindings: claim, enqueueFindings: enqueue },
      },
      { ...enabled, HEALTH_REPAIR_CLAIM_LIMIT: "10" },
    );

    const claimed = claim.mock.calls.flatMap(
      (call) => (call as unknown as [string, string, string[]])[2],
    );
    expect(claimed).toHaveLength(10);
    // Every critical is claimed before any low — a truncated claim must not be
    // an arbitrary slice of detector emission order.
    expect(claimed.filter((f) => f.startsWith("sentry:crit-"))).toHaveLength(5);
    // The cap bounds the claim, never the enqueue: the rest stays queued.
    expect(result.skippedActions).toContain("claim_limit:10/45");
  });

  it("spends the claim budget on findings the repair stage can act on", async () => {
    // Reproduces run 31443830086 (2026-08-11): 24 link findings and 131 quality
    // findings, all `medium`. Ordering by severity then fingerprint made
    // "link:" < "quality:" decide the whole cap, so all 25 slots went to link
    // findings — data cleanups with no changedFiles that buildRepairSnapshot
    // discards. The snapshot came out empty, the repair step never fired, and
    // the run reported "0 repaired; no repair PR created" while 131 repairable
    // dead-code findings sat pending. Severity must not outrank repairability.
    const findings = [
      ...Array.from({ length: 24 }, (_, i) => ({
        ...finding(`link:link-cleanup:${String(i).padStart(3, "0")}`),
        changedFiles: [],
        severity: "medium" as const,
      })),
      ...Array.from({ length: 131 }, (_, i) => ({
        ...finding(`quality:dead-code:${String(i).padStart(3, "0")}`),
        changedFiles: ["src/lib/services/spend.ts"],
        severity: "medium" as const,
      })),
    ];
    const claim = vi.fn(async () => []);

    const result = await enqueueAndClaimPolicyBatches(
      { findings, leaseOwner: "run-starve", mode: "live" },
      {
        database: {
          claimFindings: claim,
          enqueueFindings: vi.fn(async () => undefined),
        },
      },
      enabled,
    );

    const claimed = claim.mock.calls.flatMap(
      (call) => (call as unknown as [string, string, string[]])[2],
    );
    expect(claimed).toHaveLength(25);
    expect(claimed.every((f) => f.startsWith("quality:dead-code:"))).toBe(true);
    expect(result.skippedActions).toContain("claim_unrepairable:24");
  });

  it("never spends claim slots on findings the repair stage cannot act on", async () => {
    // Ordering alone only protects the front of the claim. Once repairable work
    // runs short, unrepairable findings fill the remainder — 4 fixable plus 21
    // that are not. Those 21 charge an attempt each against a two-attempt
    // retirement budget and leave review facing findings no repair touched, so
    // the run opens no PR and the rows are two attempts closer to retirement
    // for work that was never possible. The claim must be repairable-only.
    const findings = [
      ...Array.from({ length: 4 }, (_, i) => ({
        ...finding(`quality:dead-code:${i}`),
        changedFiles: ["src/lib/services/spend.ts"],
        severity: "medium" as const,
      })),
      ...Array.from({ length: 21 }, (_, i) => ({
        ...finding(`link:link-cleanup:${String(i).padStart(3, "0")}`),
        changedFiles: [],
        severity: "high" as const,
      })),
    ];
    const claim = vi.fn(async () => []);

    const result = await enqueueAndClaimPolicyBatches(
      { findings, leaseOwner: "run-short-repairable", mode: "live" },
      {
        database: {
          claimFindings: claim,
          enqueueFindings: vi.fn(async () => undefined),
        },
      },
      enabled,
    );

    const claimed = claim.mock.calls.flatMap(
      (call) => (call as unknown as [string, string, string[]])[2],
    );
    // Four slots used out of a limit of 25 — the rest deliberately unspent.
    expect(claimed).toHaveLength(4);
    expect(claimed.every((f) => f.startsWith("quality:dead-code:"))).toBe(true);
    expect(result.skippedActions).toContain("claim_unrepairable:21");
    // The whole backlog is still enqueued; only the claim is withheld.
    expect(result.skippedActions).not.toContain("claim_limit:4/25");
  });

  it("names an eligible backlog that no repair stage can act on", async () => {
    // Otherwise the failure mode is silent: a green run, an empty PR set, and
    // nothing in the report explaining why the queue never drains.
    const findings = Array.from({ length: 3 }, (_, i) => ({
      ...finding(`link:link-cleanup:${i}`),
      changedFiles: [],
      severity: "medium" as const,
    }));

    const result = await enqueueAndClaimPolicyBatches(
      { findings, leaseOwner: "run-unrepairable", mode: "live" },
      {
        database: {
          claimFindings: vi.fn(async () => []),
          enqueueFindings: vi.fn(async () => undefined),
        },
      },
      enabled,
    );

    expect(result.skippedActions).toContain("claim_unrepairable:3");
  });

  it("defaults the claim cap when the override is absent or nonsense", async () => {
    expect(repairClaimLimit({})).toBe(25);
    expect(repairClaimLimit({ HEALTH_REPAIR_CLAIM_LIMIT: "0" })).toBe(25);
    expect(repairClaimLimit({ HEALTH_REPAIR_CLAIM_LIMIT: "-5" })).toBe(25);
    expect(repairClaimLimit({ HEALTH_REPAIR_CLAIM_LIMIT: "abc" })).toBe(25);
    expect(repairClaimLimit({ HEALTH_REPAIR_CLAIM_LIMIT: "50" })).toBe(50);
  });

  it("claims human work when the automatic-active query is unavailable", async () => {
    const claim = vi.fn(async (policy: MergePolicy) =>
      policy === "human"
        ? [finding("directory:human", "human", "directory") as RepairFinding]
        : [],
    );
    const result = await enqueueAndClaimPolicyBatches(
      {
        findings: [finding("directory:human", "human", "directory")],
        leaseOwner: "run-unknown-automatic-state",
        mode: "live",
      },
      {
        database: {
          claimFindings: claim,
          enqueueFindings: async () => undefined,
        },
      },
      enabled,
    );

    expect(claim).toHaveBeenCalledWith("human", "run-unknown-automatic-state", [
      "directory:human",
    ]);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(result.human.findings).toHaveLength(1);
  });

  it("allows only the explicit canary scope while live variables remain disabled", () => {
    expect(
      mutationPolicy("canary_fix", {
        HEALTH_AGENT_ENABLED: "true",
        HEALTH_AUTOFIX_ENABLED: "false",
      }),
    ).toEqual({ autofix: true, business: true });
  });

  it("synthesizes one harmless, traceable App canary repair", async () => {
    const enqueue = vi.fn(async () => undefined);
    const claim = vi.fn(async () => []);
    const result = await enqueueAndClaimPolicyBatches(
      {
        canaryFingerprints: ["directory:canary:github-app-pr"],
        findings: [finding("sentry:production")],
        leaseOwner: "github-actions:987654321:1",
        mode: "canary_fix",
      },
      {
        database: {
          claimFindings: claim,
          enqueueFindings: enqueue,
        },
      },
      enabled,
    );

    expect(enqueue).toHaveBeenCalledWith([
      expect.objectContaining({
        evidence: expect.objectContaining({
          canary: true,
          changedFiles: ["health-agent-canary.txt"],
          desiredMarker: "github-actions:987654321:1",
        }),
        fingerprint: "directory:canary:github-app-pr",
        mergePolicy: "automatic",
      }),
    ]);
    expect(result.enqueuedFingerprints).toEqual([
      "directory:canary:github-app-pr",
    ]);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith(
      "automatic",
      "github-actions:987654321:1",
      ["directory:canary:github-app-pr"],
    );
    expect(result.skippedActions).toContain("canary:sentry:production");
  });

  it("bounds the provider-backed Sentry canary using the evidence returned by production", async () => {
    const fingerprint = "sentry:issue:88442211";
    const enqueue = vi.fn(async () => undefined);
    const claim = vi.fn(async () => []);
    const result = await enqueueAndClaimPolicyBatches(
      {
        canaryFingerprints: [fingerprint],
        findings: [
          {
            changedFiles: [],
            evidence: {
              latestEvent: {
                eventId: "0d316788727e48b0911d20d90c640d51",
                occurredAt: "2026-07-27T08:29:05.149Z",
              },
              provider: { issueId: "88442211" },
              rootCauseEvidence: {
                culprit: "verifyHealthAgentCanary(health-agent-canary.txt)",
                stack: [],
                tags: { runtime: "node v26.5.0" },
              },
            },
            fingerprint,
            humanReason: "Review required",
            mergePolicy: "human",
            sentryIssueId: "88442211",
            severity: "low",
            source: "sentry",
            title:
              "HealthAgentLifecycleCanaryError: Health Agent lifecycle canary marker mismatch: expected sentry-lifecycle-1785140945140",
          },
        ],
        leaseOwner: "github-actions:123:1",
        mode: "canary_fix",
      },
      {
        database: {
          claimFindings: claim,
          enqueueFindings: enqueue,
        },
      },
      enabled,
    );

    expect(result.enqueuedFingerprints).toEqual([fingerprint]);
    expect(enqueue).toHaveBeenCalledWith([
      expect.objectContaining({
        evidence: expect.objectContaining({
          canary: true,
          canaryKind: "sentry-real-lifecycle",
          changedFiles: ["health-agent-canary.txt"],
          desiredMarker: "sentry-lifecycle-1785140945140",
        }),
        fingerprint,
        mergePolicy: "human",
        sentryIssueId: "88442211",
      }),
    ]);
    expect(claim).toHaveBeenCalledWith("human", "github-actions:123:1", [
      fingerprint,
    ]);
  });

  it("rejects a Sentry canary without exact provider identity", async () => {
    const enqueue = vi.fn(async () => undefined);
    const claim = vi.fn(async () => []);
    const result = await enqueueAndClaimPolicyBatches(
      {
        canaryFingerprints: ["sentry:issue:88442211"],
        findings: [
          {
            evidence: {
              rootCauseEvidence: {
                stack: ["/app/health-agent-canary.txt:1:1"],
                tags: {
                  runtime:
                    "health-agent-real-lifecycle:sentry-lifecycle-1785140945140",
                },
              },
            },
            fingerprint: "sentry:issue:88442211",
            mergePolicy: "human",
            severity: "low",
            source: "sentry",
            title: "HealthAgentLifecycleCanaryError",
          },
        ],
        mode: "canary_fix",
      },
      {
        database: {
          claimFindings: claim,
          enqueueFindings: enqueue,
        },
      },
      enabled,
    );

    expect(result.suppressed).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("never promotes tagged Sentry evidence outside canary mode", async () => {
    const enqueue = vi.fn(async () => undefined);
    await enqueueAndClaimPolicyBatches(
      {
        findings: [
          {
            changedFiles: [],
            evidence: {
              provider: { issueId: "88442211" },
              rootCauseEvidence: {
                stack: ["/app/health-agent-canary.txt:1:1"],
                tags: {
                  runtime:
                    "health-agent-real-lifecycle:sentry-lifecycle-1785140945140",
                },
              },
            },
            fingerprint: "sentry:issue:88442211",
            mergePolicy: "human",
            sentryIssueId: "88442211",
            severity: "low",
            source: "sentry",
            title:
              "HealthAgentLifecycleCanaryError: expected sentry-lifecycle-1785140945140",
          },
        ],
        mode: "live",
      },
      {
        database: {
          claimFindings: async () => [],
          enqueueFindings: enqueue,
        },
      },
      { HEALTH_AGENT_ENABLED: "true", HEALTH_AUTOFIX_ENABLED: "false" },
    );

    expect(enqueue).toHaveBeenCalledWith([
      expect.objectContaining({
        evidence: expect.not.objectContaining({ canary: true }),
      }),
    ]);
  });

  it("publishes a scoped Sentry canary only through the human lane", async () => {
    const fingerprint = "sentry:issue:88442211";
    const canary = {
      changedFiles: ["health-agent-canary.txt"],
      evidence: {
        canary: true,
        canaryKind: "sentry-real-lifecycle",
        desiredMarker: "sentry-lifecycle-1785140945140",
        latestEvent: {
          eventId: "0d316788727e48b0911d20d90c640d51",
          occurredAt: "2026-07-27T08:29:05.149Z",
        },
        provider: { issueId: "88442211" },
        rootCauseEvidence: {
          stack: ["verifyHealthAgentCanary (/app/health-agent-canary.txt:1:1)"],
          tags: {
            runtime:
              "health-agent-real-lifecycle:sentry-lifecycle-1785140945140",
          },
        },
      },
      fingerprint,
      humanReason: "Health repairs require manager review",
      mergePolicy: "human" as const,
      sentryIssueId: "88442211",
      severity: "low" as const,
      source: "sentry" as const,
      title:
        "HealthAgentLifecycleCanaryError: Health Agent lifecycle canary marker mismatch: expected sentry-lifecycle-1785140945140",
    } as RepairFinding;
    const createPullRequest = vi.fn(async () => ({ number: 520 }));

    await expect(
      createRepairPullRequest(
        {
          batch: partitionRepairBatch([canary]).human,
          canaryFingerprints: [fingerprint],
          mode: "canary_fix",
        },
        { createPullRequest },
        enabled,
      ),
    ).resolves.toEqual({ number: 520, status: "opened" });
    expect(createPullRequest).toHaveBeenCalledOnce();
  });

  it("rejects queue rows outside the exact requested fingerprint scope", async () => {
    const result = await enqueueAndClaimPolicyBatches(
      {
        findings: [finding("directory:selected", "human", "directory")],
        leaseOwner: "run-bounded",
        mode: "live",
      },
      {
        database: {
          claimFindings: async () => [
            finding(
              "directory:unrelated",
              "human",
              "directory",
            ) as RepairFinding,
          ],
          enqueueFindings: async () => undefined,
        },
      },
      enabled,
    );

    expect(result.claimedFingerprints).toEqual([]);
    expect(result.failures).toEqual(["claim:claimed_fingerprint_out_of_scope"]);
  });
});

describe("audit redaction", () => {
  it("removes secrets, raw Sentry, user data, DB URLs, webhooks, and request bodies", async () => {
    const unsafe = {
      authorization: "Bearer visible-token",
      cookie: "session=abc",
      databaseUrl: "postgresql://name:password@db/app",
      nested: {
        requestBody: { email: "person@example.com" },
        safe: "kept",
        users: [{ id: "private" }],
        webhookUrl: "https://hooks.slack.com/services/T/B/value",
      },
      rawSentry: { title: "raw production payload" },
      token: "secret-token",
    };
    const redacted = redactForAudit(unsafe);
    expect(redacted).toMatchObject({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      databaseUrl: "[REDACTED]",
      nested: {
        requestBody: "[REDACTED]",
        safe: "kept",
        users: "[REDACTED]",
        webhookUrl: "[REDACTED]",
      },
      rawSentry: "[REDACTED]",
      token: "[REDACTED]",
    });

    const { store, values } = files();
    await writeRedactedJson("audit", unsafe, store);
    const output = values.get("audit") ?? "";
    expect(output).toContain('"safe": "kept"');
    expect(output).not.toMatch(
      /visible-token|postgresql:\/\/|hooks\.slack|person@/,
    );
  });
});
