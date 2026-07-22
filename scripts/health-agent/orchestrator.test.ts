import { describe, expect, it, vi } from "vitest";

import type { HealthFinding, MergePolicy } from "./contracts";
import type { RepairFinding } from "./repair";
import { partitionRepairBatch } from "./repair";
import {
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
  enqueueAndClaimBatch,
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
    directory: artifact("directory-health"),
    link: artifact("link-checker"),
    sentry: artifact("sentry-triage"),
    ...overrides,
  });
}

const paths = {
  "directory-health": "directory",
  "link-checker": "link",
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
      failures: ["collector_artifact_unavailable"],
      routine: "sentry-triage",
      status: "failed",
    });
  });

  it("makes Growth Pulse and traffic correlation impossible by command and routine", () => {
    expect(HEALTH_ROUTINES).toEqual([
      "link-checker",
      "directory-health",
      "sentry-triage",
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

    expect(agentHub).toHaveBeenCalledTimes(3);
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

    expect(agentHub).toHaveBeenCalledTimes(3);
    expect(slack).toHaveBeenCalledTimes(1);
    expect(result.deliveryErrors).toEqual({
      agentHub: [...HEALTH_ROUTINES],
      slack: ["health-digest"],
    });
  });

  it("gates Linear to human or exhausted findings and includes all outcomes in Slack", async () => {
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

    expect(
      linear.mock.calls[0]?.[0].findings.map(({ fingerprint }) => fingerprint),
    ).toEqual(
      expect.arrayContaining([human.fingerprint, exhausted.fingerprint]),
    );
    expect(slack.mock.calls[0]?.[0]).toMatchObject({
      actionableFindings: expect.arrayContaining([human, automatic, exhausted]),
      failures: expect.arrayContaining([
        { failure: "query failed", routine: "directory-health" },
      ]),
      linearOutcomes: [{ action: "created", fingerprint: human.fingerprint }],
      prOutcomes: [{ pr: 123, status: "opened" }],
      skippedActions: expect.arrayContaining([
        { action: "cleanup human-owned", routine: "directory-health" },
      ]),
    });
    expect(
      result.envelopes.every(({ tickets_created }) =>
        tickets_created.includes("FOR-88"),
      ),
    ).toBe(true);
  });

  it("suppresses Linear in preflight while still reporting the skip", async () => {
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
    expect(slack.mock.calls[0]?.[0]).toMatchObject({
      skippedActions: [{ action: "linear", reason: "mutations_disabled" }],
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
      { claim, enqueue, hasUnconfirmedAutomatic: async () => false },
      enabled,
    );
    expect(result.suppressed).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("enqueues without a cap, snapshots automatic work first, and excludes late findings", async () => {
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
    const claim = vi.fn(async (policy: MergePolicy) => claims[policy]);
    const result = await enqueueAndClaimBatch(
      {
        findings: [...automatic, ...human],
        leaseOwner: "run-2",
        mode: "live",
      },
      {
        claim,
        enqueue,
        hasUnconfirmedAutomatic: async () => false,
      },
      enabled,
    );

    expect(enqueue).toHaveBeenCalledTimes(62);
    expect(result.automatic.findings).toHaveLength(35);
    expect(result.human.findings).toHaveLength(0);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith("automatic", "run-2");
    claims.automatic.push(finding("sentry:late") as RepairFinding);
    expect(result.automatic.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fingerprint: "sentry:late" }),
      ]),
    );
  });

  it("claims human work only when no automatic batch is claimed or unconfirmed", async () => {
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
        hasUnconfirmedAutomatic: async () => false,
      },
      enabled,
    );
    expect(result.automatic.findings).toHaveLength(0);
    expect(result.human.findings).toHaveLength(1);
    expect(claim.mock.calls.map(([policy]) => policy)).toEqual([
      "automatic",
      "human",
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
        hasUnconfirmedAutomatic: async () => true,
      },
      enabled,
    );
    expect(blocked.human.findings).toHaveLength(0);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith("automatic", "run-blocked");
  });

  it("applies automatic-first arbitration to the database queue boundary", async () => {
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
          hasUnconfirmedAutomatic: async () => false,
        },
      },
      enabled,
    );

    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith("automatic", "run-database");
    expect(result.automatic.findings).toHaveLength(1);
    expect(result.human.findings).toHaveLength(0);
  });

  it("does not claim human work when the automatic-active query is unavailable", async () => {
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

    expect(claim).toHaveBeenCalledWith(
      "automatic",
      "run-unknown-automatic-state",
    );
    expect(claim).toHaveBeenCalledTimes(1);
    expect(result.human.findings).toHaveLength(0);
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
          hasUnconfirmedAutomatic: async () => false,
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
    expect(result.skippedActions).toContain("canary:sentry:production");
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
