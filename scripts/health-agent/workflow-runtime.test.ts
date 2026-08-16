import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { DirectoryHealthInput } from "./directory";
import type { AuditRecord } from "./contracts";
import {
  cleanupStaleBranches,
  collectDirectoryEvidence,
  collectLinkArtifact,
  combineSentryClassificationArtifact,
  createRpcClient,
  createWorkflowRuntimeDependencies,
  deliverRepairFailure,
  deliverRepairResult,
  deliverFinalHealthReport,
  enqueueAndClaimWorkflowBatch,
  finalizeSentryArtifact,
  makeDirectoryArtifact,
  makeLinkArtifact,
  runWorkflowCommand,
  runAggregateAndDeliver,
  safePhaseStatus,
  type RepairFailureInput,
  type RepairResultInput,
} from "./workflow-runtime";

describe("workflow result normalization", () => {
  it("maps GitHub failure and cancellation results to failed", () => {
    expect(safePhaseStatus("failure")).toBe("failed");
    expect(safePhaseStatus("cancelled")).toBe("failed");
    expect(safePhaseStatus("skipped")).toBe("skipped");
  });
});

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

function terminalAggregate() {
  const artifact = (
    routine:
      | "directory-health"
      | "link-checker"
      | "quality-health"
      | "sentry-triage"
      | "cron-health",
    findings: readonly unknown[],
  ) => ({
    collectedAt: now,
    evidence: {},
    failures: [] as string[],
    findings,
    routine,
    skippedActions: [],
    ...(routine === "sentry-triage"
      ? { snapshot: { hasMore: false, incidentMode: false } }
      : {}),
    status: "success",
    version: 1,
  });
  return {
    artifacts: {
      "directory-health": artifact("directory-health", [
        {
          evidence: {},
          fingerprint: "directory:one",
          mergePolicy: "human",
          severity: "high",
          source: "directory",
          title: "Directory issue",
        },
      ]),
      "link-checker": artifact("link-checker", [
        {
          evidence: {},
          fingerprint: "link:one",
          mergePolicy: "human",
          severity: "medium",
          source: "link",
          title: "Link issue",
        },
      ]),
      "quality-health": artifact("quality-health", []),
      "cron-health": artifact("cron-health", []),
      "sentry-triage": artifact("sentry-triage", [
        {
          evidence: {},
          fingerprint: "sentry:one",
          mergePolicy: "automatic",
          severity: "critical",
          source: "sentry",
          title: "Sentry issue",
        },
      ]),
    },
    failures: [],
    // The aggregate stage no longer writes Linear, so it never carries an
    // identifier. The final report is the sole writer.
    linearOutcomes: [] as unknown[],
  };
}

describe("degraded vs failed run verdict", () => {
  // DEV-1424: one failed collector out of six turned the whole run red, which
  // skipped nothing technically but made every night look like a total loss and
  // left 147 valid findings from the healthy detectors stranded. A detector
  // failure must degrade the run, not fail it.
  async function verdictFor(aggregate: unknown, phases?: Record<string, string>) {
    const contents = new Map<string, string>([
      ["aggregate.json", JSON.stringify(aggregate)],
      [
        "queue.json",
        JSON.stringify({
          automatic: { findings: [] },
          claimedFingerprints: [],
          enqueuedFingerprints: ["directory:one", "link:one"],
          human: { findings: [] },
          lifecycle: { new: 1, ongoing: 1, regressed: 0 },
        }),
      ],
    ]);
    const agentHub = vi.fn(async (envelope: unknown) => void envelope);
    const slack = vi.fn(async (report: unknown) => void report);
    await deliverFinalHealthReport(
      {
        aggregateArtifactPath: "aggregate.json",
        mode: "live",
        outputPath: "final.json",
        phases: {
          analyze: "success",
          collect: "success",
          deliver: "success",
          publish: "skipped",
          repair: "skipped",
          ...(phases ?? {}),
        },
        queueArtifactPath: "queue.json",
        runAt: now,
        workflowAttempt: 1,
        workflowRunId: "987654321",
        workflowUrl: "https://github.com/ytchou/Formoria/actions/runs/987654321",
      } as unknown as Parameters<typeof deliverFinalHealthReport>[0],
      {
        delivery: { agentHub, slack },
        files: {
          read: async (path: string) => contents.get(path) ?? "",
          write: async (path: string, value: string) =>
            void contents.set(path, value),
        },
      } as unknown as Parameters<typeof deliverFinalHealthReport>[1],
    );
    const envelope = agentHub.mock.calls[0]?.[0] as {
      data: { overall_status: string };
    };
    return envelope.data.overall_status;
  }

  function withFailedDetectors(routines: readonly string[]) {
    // Round-trip through JSON so the readonly finding arrays from
    // terminalAggregate() become plain mutable objects.
    const base = JSON.parse(JSON.stringify(terminalAggregate())) as {
      artifacts: Record<
        string,
        { failures: string[]; findings: unknown[]; status: string }
      >;
    };
    for (const routine of routines) {
      const artifact = base.artifacts[routine];
      if (!artifact) throw new Error(`unknown routine ${routine}`);
      artifact.status = "failed";
      artifact.failures = ["sentry_collection_issues_invalid"];
      artifact.findings = [];
    }
    return base;
  }

  it("degrades rather than fails when one detector is down", async () => {
    // The exact shape of the 2026-08-09 run: Sentry broken, five detectors fine.
    await expect(verdictFor(withFailedDetectors(["sentry-triage"]))).resolves.toBe(
      "needs_attention",
    );
  });

  it("still fails when every detector is down", async () => {
    // "Degraded" would be a lie — the run produced no signal at all.
    await expect(
      verdictFor(
        withFailedDetectors([
          "directory-health",
          "link-checker",
          "quality-health",
          "cron-health",
          "sentry-triage",
        ]),
      ),
    ).resolves.toBe("failed");
  });

  it("still fails when a pipeline phase broke", async () => {
    // The machinery itself failing is a real run failure, detectors aside.
    await expect(
      verdictFor(terminalAggregate(), { analyze: "failed" }),
    ).resolves.toBe("failed");
  });
});

describe("terminal health report", () => {
  it("delivers one unified envelope and one grouped Slack summary after publish", async () => {
    const contents = new Map<string, string>([
      ["aggregate.json", JSON.stringify(terminalAggregate())],
      [
        "queue.json",
        JSON.stringify({
          automatic: { findings: [{ fingerprint: "sentry:one" }] },
          claimedFingerprints: ["sentry:one"],
          enqueuedFingerprints: ["directory:one", "link:one", "sentry:one"],
          human: { findings: [] },
          lifecycle: { new: 1, ongoing: 2, regressed: 0 },
          verifiedFixedFingerprints: ["directory:resolved"],
        }),
      ],
      [
        "automatic-pr.json",
        JSON.stringify({
          claimed_finding_ids: [automaticFindingIds[0]],
          pr_number: 142,
          status: "pr_opened",
        }),
      ],
    ]);
    const agentHub = vi.fn(async (envelope: unknown) => void envelope);
    const slack = vi.fn(async (report: unknown) => void report);
    const linear = vi.fn(async () => ({
      outcomes: [
        {
          action: "created",
          fingerprint: "health-agent:summary:v2",
          identifier: "DEV-1400",
        },
      ],
      tickets: ["DEV-1400"],
    }));
    const listUnticketedFingerprints = vi.fn(
      async (fingerprints: readonly string[]) => fingerprints,
    );
    const reserveTicketCandidates = vi.fn(async () => undefined);
    const finalizeTicketReservation = vi.fn(async () => undefined);
    const markFingerprintsTicketed = vi.fn(async () => undefined);

    const result = await deliverFinalHealthReport(
      {
        aggregateArtifactPath: "aggregate.json",
        automaticPrResultPath: "automatic-pr.json",
        mode: "live",
        outputPath: "final.json",
        phases: {
          analyze: "success",
          collect: "success",
          deliver: "success",
          publish: "success",
          repair: "success",
        },
        queueArtifactPath: "queue.json",
        runAt: now,
        workflowAttempt: 1,
        workflowRunId: "987654321",
        workflowUrl:
          "https://github.com/ytchou/Formoria/actions/runs/987654321",
      },
      {
        database: {
          finalizeTicketReservation,
          listUnticketedFingerprints,
          markFingerprintsTicketed,
          reserveTicketCandidates,
        },
        delivery: { agentHub, slack },
        files: {
          read: async (path) => contents.get(path) ?? "",
          write: async (path, value) => void contents.set(path, value),
        },
        linear,
      },
    );

    expect(agentHub).toHaveBeenCalledOnce();
    expect(agentHub.mock.calls[0]?.[0]).toMatchObject({
      data: {
        checks: {
          directory: { finding_count: 1, severities: { high: 1 } },
          link: { finding_count: 1, severities: { medium: 1 } },
          cron: { finding_count: 0, severities: {} },
          sentry: { finding_count: 1, severities: { critical: 1 } },
        },
        overall_status: "needs_attention",
        repair: {
          batches: {
            automatic: {
              finding_count: 1,
              merge_policy: "automatic",
              pr_number: 142,
              pr_url: "https://github.com/ytchou/Formoria/pull/142",
              status: "pr_opened",
            },
            human: {
              finding_count: 0,
              merge_policy: "human",
              status: "not_required",
            },
          },
          claimed: 1,
          fixed: 1,
          pull_requests: 1,
          queued: 3,
          repaired_this_run: 1,
          unresolved: 2,
        },
        totals: { finding_count: 3 },
      },
      routine: "health-agent",
      source_run_id: "github-actions:health-agent:987654321:1",
      status: "success",
      tickets_created: ["DEV-1400"],
      verdict_text: expect.stringContaining("DEV-1400"),
    });
    expect(slack).toHaveBeenCalledWith(
      expect.objectContaining({
        healthSummary: expect.objectContaining({
          overallStatus: "needs_attention",
          ticket: {
            identifier: "DEV-1400",
            url: "https://linear.app/ytchou/issue/DEV-1400",
          },
        }),
      }),
    );
    expect(linear).toHaveBeenCalledWith(
      expect.objectContaining({
        findings: expect.arrayContaining([
          expect.objectContaining({ fingerprint: "directory:one" }),
        ]),
        summary: expect.objectContaining({
          newFindings: 1,
          ongoingFindings: 2,
          fixed: 1,
          reviewFindings: 2,
          status: "needs_attention",
          totalFindings: 3,
        }),
      }),
    );
    // Only review-required findings are candidates, and only never-ticketed
    // candidates reach the adapter.
    expect(listUnticketedFingerprints).toHaveBeenCalledWith([
      "directory:one",
      "link:one",
    ]);
    expect(reserveTicketCandidates).toHaveBeenCalledWith(
      ["directory:one", "link:one"],
      expect.stringContaining("health-agent-reservation:"),
    );
    expect(finalizeTicketReservation).toHaveBeenCalledWith(
      ["directory:one", "link:one"],
      expect.stringContaining("health-agent-reservation:"),
      "DEV-1400",
    );
    expect(result).toMatchObject({
      agent_hub: "fulfilled",
      slack: "fulfilled",
    });
  });

  it("files only never-ticketed findings and stamps the ledger after the create", async () => {
    const contents = new Map<string, string>([
      ["aggregate.json", JSON.stringify(terminalAggregate())],
      [
        "queue.json",
        JSON.stringify({
          human: { findings: [] },
          lifecycle: { new: 2, ongoing: 0, regressed: 0 },
        }),
      ],
    ]);
    const agentHub = vi.fn(async () => undefined);
    const slack = vi.fn(async (report: unknown) => {
      void report;
      return undefined;
    });
    const linear = vi.fn(
      async (input: { findings: readonly { fingerprint: string }[] }) => {
        void input;
        return {
          outcomes: [
            {
              action: "created",
              fingerprint: "health-agent:summary:v2",
              identifier: "DEV-1401",
            },
          ],
        };
      },
    );
    // "link:one" already carries a ticketed_at stamp from an earlier run.
    const listUnticketedFingerprints = vi.fn(async () => ["directory:one"]);
    const reserveTicketCandidates = vi.fn(async () => undefined);
    const finalizeTicketReservation = vi.fn(async () => undefined);
    const markFingerprintsTicketed = vi.fn(async () => undefined);

    await deliverFinalHealthReport(
      {
        aggregateArtifactPath: "aggregate.json",
        mode: "live",
        outputPath: "final.json",
        phases: {
          analyze: "success",
          collect: "success",
          deliver: "success",
          publish: "success",
          repair: "success",
        },
        queueArtifactPath: "queue.json",
        runAt: now,
        workflowAttempt: 1,
        workflowRunId: "987654321",
      },
      {
        database: {
          finalizeTicketReservation,
          listUnticketedFingerprints,
          markFingerprintsTicketed,
          reserveTicketCandidates,
        },
        delivery: { agentHub, slack },
        files: {
          read: async (path) => contents.get(path) ?? "",
          write: async (path, value) => void contents.set(path, value),
        },
        linear,
      },
    );

    expect(
      linear.mock.calls[0]?.[0].findings.map(({ fingerprint }) => fingerprint),
    ).toEqual(["directory:one"]);
    expect(reserveTicketCandidates).toHaveBeenCalledWith(
      ["directory:one"],
      expect.stringContaining("health-agent-reservation:"),
    );
    expect(finalizeTicketReservation).toHaveBeenCalledWith(
      ["directory:one"],
      expect.stringContaining("health-agent-reservation:"),
      "DEV-1401",
    );
  });

  it("reserves fingerprints before Linear creation and keeps them ineligible after ledger finalization fails", async () => {
    const contents = new Map<string, string>([
      ["aggregate.json", JSON.stringify(terminalAggregate())],
      [
        "queue.json",
        JSON.stringify({
          human: { findings: [] },
          lifecycle: { new: 2, ongoing: 0, regressed: 0 },
        }),
      ],
    ]);
    const events: string[] = [];
    let reserved = false;
    const listUnticketedFingerprints = vi.fn(
      async (fingerprints: readonly string[]) => (reserved ? [] : fingerprints),
    );
    const reserveTicketCandidates = vi.fn(async () => {
      events.push("reserve");
      reserved = true;
    });
    const finalizeTicketReservation = vi.fn(async () => {
      events.push("finalize");
      throw new Error("ledger_finalize_failed");
    });
    const releaseTicketReservation = vi.fn(async () => {
      events.push("release");
      throw new Error("ledger_release_failed");
    });
    const linear = vi.fn(async () => {
      events.push("linear");
      return {
        outcomes: [
          {
            action: "created",
            fingerprint: "health-agent:summary:v2",
            identifier: "DEV-1406",
          },
        ],
      };
    });
    const dependencies = {
      database: {
        finalizeTicketReservation,
        listUnticketedFingerprints,
        releaseTicketReservation,
        reserveTicketCandidates,
      },
      delivery: {
        agentHub: vi.fn(async () => undefined),
        slack: vi.fn(async () => undefined),
      },
      files: {
        read: async (path: string) => contents.get(path) ?? "",
        write: async (path: string, value: string) =>
          void contents.set(path, value),
      },
      linear,
    };

    await deliverFinalHealthReport(
      {
        aggregateArtifactPath: "aggregate.json",
        mode: "live",
        outputPath: "first-final.json",
        phases: {
          analyze: "success",
          collect: "success",
          deliver: "success",
          publish: "success",
          repair: "success",
        },
        queueArtifactPath: "queue.json",
        runAt: now,
        workflowAttempt: 1,
        workflowRunId: "987654321",
      },
      dependencies,
    );
    await deliverFinalHealthReport(
      {
        aggregateArtifactPath: "aggregate.json",
        mode: "live",
        outputPath: "second-final.json",
        phases: {
          analyze: "success",
          collect: "success",
          deliver: "success",
          publish: "success",
          repair: "success",
        },
        queueArtifactPath: "queue.json",
        runAt: now,
        workflowAttempt: 2,
        workflowRunId: "987654321",
      },
      dependencies,
    );

    expect(events).toEqual(["reserve", "linear", "finalize"]);
    expect(linear).toHaveBeenCalledOnce();
    expect(releaseTicketReservation).not.toHaveBeenCalled();
  });

  it("skips the Linear write entirely when every candidate is already ticketed", async () => {
    const contents = new Map<string, string>([
      ["aggregate.json", JSON.stringify(terminalAggregate())],
      [
        "queue.json",
        JSON.stringify({
          human: { findings: [] },
          lifecycle: { new: 0, ongoing: 2, regressed: 0 },
        }),
      ],
    ]);
    const agentHub = vi.fn(async () => undefined);
    const slack = vi.fn(async (report: unknown) => {
      void report;
      return undefined;
    });
    const linear = vi.fn(async () => ({ outcomes: [] }));
    const listUnticketedFingerprints = vi.fn(async () => []);
    const markFingerprintsTicketed = vi.fn(async () => undefined);

    await deliverFinalHealthReport(
      {
        aggregateArtifactPath: "aggregate.json",
        mode: "live",
        outputPath: "final.json",
        phases: {
          analyze: "success",
          collect: "success",
          deliver: "success",
          publish: "success",
          repair: "success",
        },
        queueArtifactPath: "queue.json",
        runAt: now,
        workflowAttempt: 1,
        workflowRunId: "987654321",
      },
      {
        database: { listUnticketedFingerprints, markFingerprintsTicketed },
        delivery: { agentHub, slack },
        files: {
          read: async (path) => contents.get(path) ?? "",
          write: async (path, value) => void contents.set(path, value),
        },
        linear,
      },
    );

    expect(linear).not.toHaveBeenCalled();
    expect(markFingerprintsTicketed).not.toHaveBeenCalled();
    expect(slack.mock.calls[0]?.[0]).not.toHaveProperty("healthSummary.ticket");
  });

  it("records an optional warning without throwing when the ticket ledger PATCH fails", async () => {
    const contents = new Map<string, string>([
      ["aggregate.json", JSON.stringify(terminalAggregate())],
      [
        "queue.json",
        JSON.stringify({
          human: { findings: [] },
          lifecycle: { new: 2, ongoing: 0, regressed: 0 },
        }),
      ],
    ]);
    const agentHub = vi.fn(async (envelope: unknown) => void envelope);
    const slack = vi.fn(async () => undefined);
    const linear = vi.fn(async () => ({
      outcomes: [
        {
          action: "created",
          fingerprint: "health-agent:summary:v2",
          identifier: "DEV-1402",
        },
      ],
    }));

    await expect(
      deliverFinalHealthReport(
        {
          aggregateArtifactPath: "aggregate.json",
          mode: "live",
          outputPath: "final.json",
          phases: {
            analyze: "success",
            collect: "success",
            deliver: "success",
            publish: "success",
            repair: "success",
          },
          queueArtifactPath: "queue.json",
          runAt: now,
          workflowAttempt: 1,
          workflowRunId: "987654321",
        },
        {
          database: {
            finalizeTicketReservation: async () => {
              throw new Error("patch_failed");
            },
            listUnticketedFingerprints: async (fingerprints) => fingerprints,
            reserveTicketCandidates: async () => undefined,
          },
          delivery: { agentHub, slack },
          files: {
            read: async (path) => contents.get(path) ?? "",
            write: async (path, value) => void contents.set(path, value),
          },
          linear,
        },
      ),
    ).resolves.toMatchObject({ agent_hub: "fulfilled" });

    expect(agentHub.mock.calls[0]?.[0]).toMatchObject({
      data: {
        delivery_warnings: [
          expect.objectContaining({
            code: "linear_ticket_ledger_failed",
            operation: "finalize_health_fingerprint_tickets",
          }),
        ],
        overall_status: "needs_attention",
      },
      status: "success",
    });
  });

  it("keeps a ticket-ledger lookup failure optional and preserves its diagnostic warning", async () => {
    const contents = new Map<string, string>([
      ["aggregate.json", JSON.stringify(terminalAggregate())],
      [
        "queue.json",
        JSON.stringify({
          human: { findings: [] },
          lifecycle: { new: 2, ongoing: 0, regressed: 0 },
        }),
      ],
    ]);
    const agentHub = vi.fn(async (envelope: unknown) => void envelope);
    const slack = vi.fn(async (report: unknown) => void report);
    const linear = vi.fn(async () => ({ outcomes: [] }));

    const result = await deliverFinalHealthReport(
      {
        aggregateArtifactPath: "aggregate.json",
        mode: "live",
        outputPath: "final.json",
        phases: {
          analyze: "success",
          collect: "success",
          deliver: "success",
          publish: "success",
          repair: "success",
        },
        queueArtifactPath: "queue.json",
        runAt: now,
        workflowAttempt: 1,
        workflowRunId: "987654321",
      },
      {
        database: {
          listUnticketedFingerprints: async () => {
            throw new Error("ledger_reader_unavailable");
          },
          markFingerprintsTicketed: vi.fn(async () => undefined),
        },
        delivery: { agentHub, slack },
        files: {
          read: async (path) => contents.get(path) ?? "",
          write: async (path, value) => void contents.set(path, value),
        },
        linear,
      },
    );

    const envelope = agentHub.mock.calls[0]?.[0] as {
      data?: Record<string, unknown>;
      status?: string;
    };
    expect(result).toMatchObject({
      agent_hub: "fulfilled",
      slack: "fulfilled",
    });
    expect(envelope).toMatchObject({
      data: {
        delivery_warnings: [
          expect.objectContaining({
            code: "linear_ticket_candidates_failed",
            operation: "list_unticketed_health_fingerprints",
          }),
        ],
        overall_status: "needs_attention",
      },
      status: "success",
    });
    expect(envelope.data?.failures ?? []).not.toContain(
      "linear_ticket_candidates:failed",
    );
    expect(slack.mock.calls[0]?.[0]).toMatchObject({
      healthSummary: expect.objectContaining({
        deliveryWarnings: [
          expect.objectContaining({
            code: "linear_ticket_candidates_failed",
          }),
        ],
        overallStatus: "needs_attention",
      }),
    });
    expect(linear).not.toHaveBeenCalled();
    expect(JSON.parse(contents.get("final.json") ?? "{}")).toMatchObject({
      envelope: expect.objectContaining({
        data: expect.objectContaining({
          delivery_warnings: expect.arrayContaining([
            expect.objectContaining({
              operation: "list_unticketed_health_fingerprints",
            }),
          ]),
        }),
      }),
    });
  });

  it("persists required delivery failures separately from the detector verdict", async () => {
    const contents = new Map<string, string>([
      ["aggregate.json", JSON.stringify(terminalAggregate())],
    ]);
    const agentHub = vi.fn(async () => {
      throw new Error("agent_hub_unavailable");
    });
    const slack = vi.fn(async () => undefined);

    await expect(
      deliverFinalHealthReport(
        {
          aggregateArtifactPath: "aggregate.json",
          mode: "preflight",
          outputPath: "final.json",
          phases: {
            analyze: "success",
            collect: "success",
            deliver: "success",
            publish: "success",
            repair: "success",
          },
          runAt: now,
          workflowAttempt: 1,
          workflowRunId: "987654321",
        },
        {
          delivery: { agentHub, slack },
          files: {
            read: async (path) => contents.get(path) ?? "",
            write: async (path, value) => void contents.set(path, value),
          },
        },
      ),
    ).rejects.toThrow("final_report_delivery_failed");

    expect(JSON.parse(contents.get("final.json") ?? "{}")).toMatchObject({
      envelope: {
        data: { overall_status: "needs_attention" },
        status: "success",
      },
      infrastructure_failures: [
        expect.objectContaining({
          category: "infrastructure",
          code: "agent_hub_delivery_failed",
          operation: "deliver_envelope",
        }),
      ],
      terminal: true,
    });
  });

  it("delivers an upstream failure without failing the terminal command", async () => {
    const contents = new Map<string, string>();
    const agentHub = vi.fn(async () => undefined);
    const slack = vi.fn(async () => undefined);

    await expect(
      deliverFinalHealthReport(
        {
          mode: "preflight",
          outputPath: "final.json",
          phases: {
            analyze: "failed",
            collect: "success",
            deliver: "skipped",
            publish: "skipped",
            repair: "skipped",
          },
          runAt: now,
          workflowAttempt: 1,
          workflowRunId: "987654321",
        },
        {
          delivery: { agentHub, slack },
          files: {
            read: async (path) => contents.get(path) ?? "",
            write: async (path, value) => void contents.set(path, value),
          },
        },
      ),
    ).resolves.toMatchObject({ agent_hub: "fulfilled", slack: "fulfilled" });

    expect(agentHub).toHaveBeenCalledOnce();
    expect(slack).toHaveBeenCalledOnce();
    expect(contents.has("final.json")).toBe(true);
  });

  it("treats handled queue adapter failures as terminal pipeline failures", async () => {
    const contents = new Map<string, string>([
      ["aggregate.json", JSON.stringify(terminalAggregate())],
      [
        "queue.json",
        JSON.stringify({ failures: ["enqueue:rpc_request_failed"] }),
      ],
    ]);
    const agentHub = vi.fn(async (envelope: unknown) => void envelope);
    const slack = vi.fn(async (report: unknown) => void report);

    await expect(
      deliverFinalHealthReport(
        {
          aggregateArtifactPath: "aggregate.json",
          mode: "preflight",
          outputPath: "final.json",
          phases: {
            analyze: "success",
            collect: "success",
            deliver: "success",
            publish: "success",
            repair: "success",
          },
          queueArtifactPath: "queue.json",
          runAt: now,
          workflowAttempt: 1,
          workflowRunId: "987654321",
        },
        {
          delivery: { agentHub, slack },
          files: {
            read: async (path) => contents.get(path) ?? "",
            write: async (path, value) => void contents.set(path, value),
          },
        },
      ),
    ).resolves.toMatchObject({ agent_hub: "fulfilled", slack: "fulfilled" });

    expect(agentHub.mock.calls[0]?.[0]).toMatchObject({
      data: { failures: ["enqueue:rpc_request_failed"] },
      status: "failed",
    });
    expect(slack).toHaveBeenCalledOnce();
  });

  it("keeps Linear active when only exhausted automatic findings remain", async () => {
    const aggregate = terminalAggregate();
    aggregate.artifacts["directory-health"].findings = [];
    aggregate.artifacts["link-checker"].findings = [];
    const contents = new Map([
      ["aggregate.json", JSON.stringify(aggregate)],
      [
        "queue.json",
        JSON.stringify({
          automatic: { findings: [{ fingerprint: "sentry:one" }] },
          lifecycle: { new: 0, ongoing: 1, regressed: 0 },
        }),
      ],
    ]);
    const agentHub = vi.fn(async () => undefined);
    const slack = vi.fn(async () => undefined);
    const linear = vi.fn(async () => ({
      outcomes: [
        {
          action: "created",
          fingerprint: "health-agent:summary:v2",
          identifier: "DEV-1403",
        },
      ],
    }));

    await deliverFinalHealthReport(
      {
        aggregateArtifactPath: "aggregate.json",
        mode: "live",
        outputPath: "final.json",
        phases: {
          analyze: "success",
          collect: "success",
          deliver: "success",
          publish: "success",
          repair: "success",
        },
        queueArtifactPath: "queue.json",
        runAt: now,
        workflowAttempt: 1,
        workflowRunId: "987654321",
      },
      {
        database: {
          finalizeTicketReservation: vi.fn(async () => undefined),
          listUnticketedFingerprints: vi.fn(
            async (fingerprints) => fingerprints,
          ),
          reserveTicketCandidates: vi.fn(async () => undefined),
        },
        delivery: { agentHub, slack },
        files: {
          read: async (path) => contents.get(path) ?? "",
          write: async (path, value) => void contents.set(path, value),
        },
        linear,
      },
    );

    expect(linear).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({
          reviewFindings: 1,
          status: "needs_attention",
          totalFindings: 1,
        }),
      }),
    );
    expect(slack).toHaveBeenCalledWith(
      expect.objectContaining({
        healthSummary: expect.objectContaining({
          overallStatus: "needs_attention",
          ticket: expect.objectContaining({ identifier: "DEV-1403" }),
        }),
      }),
    );
  });
});

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
    const brandId = "4ce279a6-b1dc-4836-ae92-aad0acfc5431";
    const artifact = makeLinkArtifact(
      {
        blocked: 0,
        broken: 1,
        checked: 1,
        cleanupRequired: [
          {
            brandId,
            field: "purchase_website",
            url: "https://secret.example/path?token=value",
          },
        ],
        failingRows: [
          {
            brandId,
            failureDates: ["2026-07-23", "2026-07-24", "2026-07-25"],
            field: "purchase_website",
            recordId: `${brandId}:purchase_website`,
            statusCode: 404,
          },
        ],
        heroBroken: [],
        heroExternal: [],
        ok: 0,
        severity: "warning",
      },
      now,
    );

    expect(artifact.findings).toEqual([
      expect.objectContaining({
        fingerprint: `link:link-cleanup:${brandId}:purchase_website`,
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
        issues: [
          {
            issue,
            provider: {
              issueId: "88442211",
              permalink:
                "https://sentry.io/organizations/formoria/issues/88442211/",
              shortId: "FORMORIA-321",
            },
          },
        ],
        requestCount: 1,
      },
      [classification],
      now,
    );
    expect(artifact.findings[0]).toMatchObject({
      fingerprint: "sentry:issue:88442211",
      mergePolicy: "automatic",
      sentryIssueId: "88442211",
      source: "sentry",
    });
    expect(() =>
      finalizeSentryArtifact(
        {
          candidateIssueCount: 1,
          hasMore: false,
          incidentMode: false,
          issues: [
            {
              issue,
              provider: {
                issueId: "88442211",
                permalink: null,
                shortId: "FORMORIA-321",
              },
            },
          ],
          requestCount: 1,
        },
        [{ ...classification, confidence: 2 }],
        now,
      ),
    ).toThrow();
  });
});

describe("health-agent admission", () => {
  it("reuses one ledger identity when a workflow attempt reclaims a run", async () => {
    const contents = new Map<string, string>([
      ["final-report.json", JSON.stringify({ terminal: true })],
    ]);
    const fetchImplementation = vi.fn<typeof fetch>(async (request, _init) => {
      const url = String(request);
      if (url.endsWith("/rest/v1/rpc/claim_health_agent_run")) {
        return new Response(JSON.stringify({ claimed: true, replay: false }), {
          status: 200,
        });
      }
      if (url.endsWith("/rest/v1/rpc/complete_health_agent_run")) {
        return new Response("true", { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const files = {
      read: async (path: string) => contents.get(path) ?? "",
      write: async (path: string, value: string) => {
        contents.set(path, value);
      },
    };

    await runWorkflowCommand(
      "admit-run",
      {
        mode: "live",
        outputPath: "admission-1.json",
        runAt: now,
        workflowAttempt: 1,
        workflowRunId: "123",
      },
      {
        env: {
          HEALTH_AGENT_WRITER_TOKEN: "writer-token",
          NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
        },
        fetchImplementation,
        files,
      },
    );
    await runWorkflowCommand(
      "admit-run",
      {
        mode: "live",
        outputPath: "admission-2.json",
        runAt: now,
        workflowAttempt: 2,
        workflowRunId: "123",
      },
      {
        env: {
          HEALTH_AGENT_WRITER_TOKEN: "writer-token",
          NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
        },
        fetchImplementation,
        files,
      },
    );
    await runWorkflowCommand(
      "finalize-run",
      {
        mode: "live",
        outputPath: "finalize-2.json",
        resultPath: "final-report.json",
        runAt: now,
        status: "success",
        workflowAttempt: 2,
        workflowRunId: "123",
      },
      {
        env: {
          HEALTH_AGENT_WRITER_TOKEN: "writer-token",
          NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
        },
        fetchImplementation,
        files,
      },
    );

    const rpcBodies = fetchImplementation.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>,
    );
    expect(rpcBodies.slice(0, 2)).toEqual([
      expect.objectContaining({
        p_requested_run_id: "gha:123",
        p_workflow_attempt: 1,
      }),
      expect.objectContaining({
        p_requested_run_id: "gha:123",
        p_workflow_attempt: 2,
      }),
    ]);
    expect(rpcBodies[2]).toEqual(
      expect.objectContaining({
        p_requested_run_id: "gha:123",
        p_workflow_attempt: 2,
      }),
    );

    const migration = await readFile(
      "supabase/migrations/20260722200000_github_health_agent_foundations.sql",
      "utf8",
    );
    expect(migration).toContain(
      "ledger.requested_run_id = EXCLUDED.requested_run_id",
    );
    expect(migration).toContain(
      "ledger.workflow_attempt < EXCLUDED.workflow_attempt",
    );
  });

  it("writes a successful duplicate terminal artifact without admitting collectors", async () => {
    const contents = new Map<string, string>();
    const files = {
      read: async (path: string) => contents.get(path) ?? "",
      write: async (path: string, value: string) => {
        contents.set(path, value);
      },
    };
    const fetchImplementation = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ claimed: false, replay: true }), {
          status: 200,
        }),
    );

    const result = await runWorkflowCommand(
      "admit-run",
      {
        mode: "live",
        outputPath: "admission.json",
        runAt: now,
        terminalOutputPath: "final-report.json",
        workflowAttempt: 1,
        workflowRunId: "123",
      },
      {
        env: {
          HEALTH_AGENT_WRITER_TOKEN: "writer-token",
          NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
        },
        fetchImplementation,
        files,
      },
    );

    expect(result).toMatchObject({
      claimed: false,
      replay: true,
      status: "duplicate",
      terminal: true,
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(JSON.parse(contents.get("final-report.json") ?? "{}")).toMatchObject(
      {
        envelope: { status: "success" },
        terminal: true,
      },
    );
  });

  it("finalizes a claimed live run through the existing ledger RPC", async () => {
    const contents = new Map<string, string>([
      ["final-report.json", JSON.stringify({ terminal: true })],
    ]);
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response("true", { status: 200 }),
    );

    const result = await runWorkflowCommand(
      "finalize-run",
      {
        mode: "live",
        outputPath: "finalize.json",
        resultPath: "final-report.json",
        runAt: now,
        status: "success",
        workflowAttempt: 1,
        workflowRunId: "123",
      },
      {
        env: {
          HEALTH_AGENT_WRITER_TOKEN: "writer-token",
          NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
        },
        fetchImplementation,
        files: {
          read: async (path) => contents.get(path) ?? "",
          write: async (path, value) => void contents.set(path, value),
        },
      },
    );

    expect(result).toMatchObject({
      finalized: true,
      routine: "health-agent",
      status: "success",
    });
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain(
      "/rest/v1/rpc/complete_health_agent_run",
    );
    expect(
      JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      p_logical_date: "2026-07-22",
      p_requested_run_id: "gha:123",
      p_routine: "health-agent",
      p_workflow_attempt: 1,
    });
  });

  it("fails the live ledger without reading a missing final report", async () => {
    const contents = new Map<string, string>();
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response("true", { status: 200 }),
    );

    const result = await runWorkflowCommand(
      "finalize-run",
      {
        mode: "live",
        outputPath: "finalize.json",
        resultPath: "missing-final-report.json",
        runAt: now,
        status: "failed",
        workflowAttempt: 1,
        workflowRunId: "123",
      },
      {
        env: {
          HEALTH_AGENT_WRITER_TOKEN: "writer-token",
          NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
        },
        fetchImplementation,
        files: {
          read: async (path) => contents.get(path) ?? "",
          write: async (path, value) => void contents.set(path, value),
        },
      },
    );

    expect(result).toMatchObject({
      finalized: true,
      routine: "health-agent",
      status: "failed",
    });
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain(
      "/rest/v1/rpc/fail_health_agent_run",
    );
    expect(
      JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      p_error: "health_agent_terminal_delivery_failed",
      p_result: expect.objectContaining({
        error: "health_agent_terminal_delivery_failed",
        terminal: true,
      }),
    });
  });

  it("downgrades a successful finalize request when the final report is corrupt", async () => {
    const contents = new Map<string, string>([
      ["final-report.json", "not-json"],
    ]);
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response("true", { status: 200 }),
    );

    const result = await runWorkflowCommand(
      "finalize-run",
      {
        mode: "live",
        outputPath: "finalize.json",
        resultPath: "final-report.json",
        runAt: now,
        status: "success",
        workflowAttempt: 1,
        workflowRunId: "123",
      },
      {
        env: {
          HEALTH_AGENT_WRITER_TOKEN: "writer-token",
          NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
        },
        fetchImplementation,
        files: {
          read: async (path) => contents.get(path) ?? "",
          write: async (path, value) => void contents.set(path, value),
        },
      },
    );

    expect(result).toMatchObject({ status: "failed" });
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain(
      "/rest/v1/rpc/fail_health_agent_run",
    );
  });
});

describe("health-agent artifact delivery", () => {
  it("records artifact upload failure as an infrastructure outcome", async () => {
    const contents = new Map<string, string>([
      [
        "health-run.json",
        JSON.stringify({
          groups: { product: { status: "success" } },
          version: 1,
        }),
      ],
    ]);

    const result = await runWorkflowCommand(
      "record-artifact-upload",
      {
        inputPath: "health-run.json",
        outputPath: "health-run.json",
        reason: "upload action failed",
        status: "failed",
      },
      {
        files: {
          read: async (path) => contents.get(path) ?? "",
          write: async (path, value) => void contents.set(path, value),
        },
      },
    );

    expect(result).toMatchObject({
      artifact_delivery: {
        status: "failed",
      },
      infrastructure_failures: [
        expect.objectContaining({
          category: "infrastructure",
          code: "health_run_artifact_upload_failed",
          operation: "upload_artifact",
        }),
      ],
    });
    expect(JSON.parse(contents.get("health-run.json") ?? "{}")).toMatchObject({
      artifact_delivery: { status: "failed" },
      infrastructure_failures: [
        expect.objectContaining({
          code: "health_run_artifact_upload_failed",
        }),
      ],
    });
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
              purchase_website: "https://brand-one.example",
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

    expect(JSON.parse(contents.get(input.outputPath) ?? "{}")).toMatchObject({
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

    expect(JSON.parse(contents.get(input.outputPath) ?? "{}")).toMatchObject({
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

    expect(JSON.parse(contents.get(input.outputPath) ?? "{}")).toMatchObject({
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
      p_requested_run_id: "gha:123",
      p_routine: "brand-review",
      p_workflow_attempt: 1,
    });
    expect(JSON.parse(String(rpcCalls[1]?.[1]?.body))).toEqual({
      p_logical_date: "2026-07-22",
      p_requested_run_id: "gha:123",
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

      expect(JSON.parse(contents.get(input.outputPath) ?? "{}")).toMatchObject({
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

    expect(JSON.parse(contents.get(input.outputPath) ?? "{}")).toMatchObject({
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

    expect(JSON.parse(contents.get(input.outputPath) ?? "{}")).toMatchObject({
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

    expect(JSON.parse(contents.get(input.outputPath) ?? "{}")).toMatchObject({
      findings: [],
      routine: "brand-review",
      status: "skipped",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(slack).not.toHaveBeenCalled();
  });
});

describe("aggregate-and-deliver runtime", () => {
  it("preserves sanitized nested Sentry evidence in the aggregate artifact", async () => {
    const sentryFinding = {
      changedFiles: ["src/app.ts"],
      evidence: {
        classification: {
          changedFiles: ["src/app.ts"],
          recurrence: { count: 2, evidence: "Two events", status: "recurring" },
        },
        latestEvent: {
          eventId: "latest-event-1",
          occurredAt: "2026-07-22T04:05:06.000Z",
        },
        provider: {
          issueId: "88442211",
          permalink:
            "https://sentry.io/organizations/formoria/issues/88442211/",
          shortId: "FORMORIA-321",
        },
        recurrence: {
          eventCount: 2,
          firstSeen: "2026-07-21T04:05:06.000Z",
          lastSeen: "2026-07-22T04:05:06.000Z",
          userCount: 0,
        },
      },
      fingerprint: "sentry:issue:88442211",
      mergePolicy: "human" as const,
      sentryIssueId: "88442211",
      severity: "medium" as const,
      source: "sentry" as const,
      title: "Production TypeError",
    };
    const contents = new Map<string, string>();
    for (const routine of [
      "link-checker",
      "directory-health",
      "quality-health",
      "sentry-triage",
      "cron-health",
    ]) {
      contents.set(
        `${routine}.json`,
        JSON.stringify({
          collectedAt: now,
          evidence: {},
          failures: [],
          findings: routine === "sentry-triage" ? [sentryFinding] : [],
          routine,
          skippedActions: [],
          snapshot:
            routine === "sentry-triage"
              ? { hasMore: false, incidentMode: false }
              : {},
          status: "success",
          version: 1,
        }),
      );
    }
    const files = {
      read: async (path: string) => contents.get(path) ?? "",
      write: async (path: string, value: string) => {
        contents.set(path, value);
      },
    };

    await runAggregateAndDeliver(
      {
        deferDelivery: true,
        directoryArtifactPath: "directory-health.json",
        linkArtifactPath: "link-checker.json",
        mode: "live",
        outputPath: "aggregate.json",
        qualityArtifactPath: "quality-health.json",
        runAt: now,
        sentryArtifactPath: "sentry-triage.json",
        workflowAttempt: 1,
        workflowRunId: "123",
      },
      { files },
    );

    const aggregate = JSON.parse(contents.get("aggregate.json") ?? "{}");
    expect(aggregate.artifacts["sentry-triage"].findings[0]).toMatchObject({
      sentryIssueId: "88442211",
      evidence: {
        latestEvent: { eventId: "latest-event-1" },
        provider: { issueId: "88442211", shortId: "FORMORIA-321" },
        recurrence: {
          eventCount: 2,
          lastSeen: "2026-07-22T04:05:06.000Z",
          userCount: 0,
        },
      },
    });
  });

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

  it("does not repeat Linear synchronization while queueing", async () => {
    const ordinaryFinding = {
      evidence: {},
      fingerprint: "directory:runtime:linear",
      mergePolicy: "human" as const,
      severity: "medium" as const,
      source: "directory" as const,
      title: "Linear-routed runtime problem",
    };
    const contents = new Map([
      ["aggregate.json", JSON.stringify(aggregateArtifact([ordinaryFinding]))],
    ]);
    const linear = {
      sync: vi.fn(async () => ({ outcomes: [], status: "sent" })),
    };

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
        linear,
        queue: {
          claim: vi.fn(async () => []),
          enqueue: vi.fn(async () => undefined),
        },
      },
    );

    expect(linear.sync).not.toHaveBeenCalled();
    expect(result.failures).not.toContain("linear:not_configured");
    expect(result.linear.status).toBe("not_required");
  });

  it("verifies absent fingerprints only after every detector succeeds", async () => {
    const contents = new Map([
      ["aggregate.json", JSON.stringify(terminalAggregate())],
    ]);
    const reconcileFingerprintLifecycle = vi.fn(async () => ({
      failedVerificationFingerprints: [],
      fixedFingerprints: ["directory:resolved"],
    }));

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
          enqueue: vi.fn(async () => undefined),
          reconcileFingerprintLifecycle,
        },
      },
    );

    expect(reconcileFingerprintLifecycle).toHaveBeenCalledWith(
      ["directory:one", "link:one", "sentry:one"],
      ["cron", "directory", "link", "quality", "sentry"],
    );
    expect(result.verifiedFixedFingerprints).toEqual(["directory:resolved"]);
  });

  it("reconciles complete sources when repository health fails independently", async () => {
    const aggregate = terminalAggregate();
    aggregate.artifacts["quality-health"].status = "failed";
    aggregate.artifacts["quality-health"].failures = [
      "dead-code:malformed_output",
    ];
    const contents = new Map([["aggregate.json", JSON.stringify(aggregate)]]);
    const reconcileFingerprintLifecycle = vi.fn(async () => ({
      failedVerificationFingerprints: [],
      fixedFingerprints: ["link:resolved"],
    }));

    await enqueueAndClaimWorkflowBatch(
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
          write: async (path, value) => void contents.set(path, value),
        },
        queue: {
          claim: vi.fn(async () => []),
          enqueue: vi.fn(async () => undefined),
          reconcileFingerprintLifecycle,
        },
      },
    );

    expect(reconcileFingerprintLifecycle).toHaveBeenCalledWith(
      ["directory:one", "link:one", "sentry:one"],
      ["cron", "directory", "link", "sentry"],
    );
  });

  it("keeps a verified Sentry row deployed when provider resolution fails", async () => {
    const contents = new Map([
      ["aggregate.json", JSON.stringify(terminalAggregate())],
    ]);
    const fetchImplementation = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ detail: "provider unavailable" }), {
          status: 503,
        }),
    );

    const result = await enqueueAndClaimWorkflowBatch(
      {
        findingsArtifactPath: "aggregate.json",
        leaseOwner: "github-actions:123:1",
        mode: "live",
        outputPath: "queue-result.json",
      },
      {
        env: {
          HEALTH_AGENT_ENABLED: "true",
          HEALTH_AUTOFIX_ENABLED: "false",
          SENTRY_BASE_URL: "https://sentry.example",
          SENTRY_READ_TOKEN: "read-write-token",
        },
        fetchImplementation,
        files: {
          read: async (path) => contents.get(path) ?? "",
          write: async (path, value) => void contents.set(path, value),
        },
        queue: {
          claim: vi.fn(async () => []),
          enqueue: vi.fn(async () => undefined),
          reconcileFingerprintLifecycle: vi.fn(async () => ({
            failedVerificationFingerprints: [],
            fixedFingerprints: [],
            verifiedSentryAbsences: [
              {
                fingerprint: "sentry:resolved-after-deployment",
                id: "46591f9f-bbba-4f82-8bee-6b0334f13167",
                issueId: "88442211",
                status: "pr_opened",
              },
            ],
          })),
        },
      },
    );

    expect(result.failures).toContain(
      "sentry_post_verification_resolution:failed",
    );
    expect(result.verifiedFixedFingerprints).not.toContain(
      "sentry:resolved-after-deployment",
    );
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("marks a Sentry row fixed only after provider resolution succeeds", async () => {
    const contents = new Map([
      ["aggregate.json", JSON.stringify(terminalAggregate())],
    ]);
    const requests: string[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({ id: "88442211" }), { status: 200 });
    });

    const result = await enqueueAndClaimWorkflowBatch(
      {
        findingsArtifactPath: "aggregate.json",
        leaseOwner: "github-actions:123:1",
        mode: "live",
        outputPath: "queue-result.json",
      },
      {
        env: {
          HEALTH_AGENT_ENABLED: "true",
          HEALTH_AUTOFIX_ENABLED: "false",
          HEALTH_AGENT_WRITER_TOKEN: "writer-token",
          NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
          SENTRY_BASE_URL: "https://sentry.example",
          SENTRY_READ_TOKEN: "read-write-token",
        },
        fetchImplementation,
        files: {
          read: async (path) => contents.get(path) ?? "",
          write: async (path, value) => void contents.set(path, value),
        },
        queue: {
          claim: vi.fn(async () => []),
          enqueue: vi.fn(async () => undefined),
          reconcileFingerprintLifecycle: vi.fn(async () => ({
            failedVerificationFingerprints: [],
            fixedFingerprints: [],
            verifiedSentryAbsences: [
              {
                fingerprint: "sentry:resolved-after-deployment",
                id: "46591f9f-bbba-4f82-8bee-6b0334f13167",
                issueId: "88442211",
                status: "pr_opened",
              },
            ],
          })),
        },
      },
    );

    expect(requests).toEqual([
      "https://sentry.example/api/0/issues/88442211/",
      "https://db.example/rest/v1/rpc/verify_health_fix_absence",
    ]);
    expect(result.verifiedFixedFingerprints).toContain(
      "sentry:resolved-after-deployment",
    );
    expect(result.verifiedFixedSentryIssueIds).toEqual(["88442211"]);
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
              sentry_issue_id: "88442211",
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

    const result = await claim("automatic", "github-actions:987654321:1", [
      "directory:canary:github-app-pr",
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        claimedFindingId: queueId,
        fingerprint: "directory:canary:github-app-pr",
        sentryIssueId: "88442211",
      }),
    ]);
    expect(
      JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)),
    ).toEqual({
      p_fingerprints: ["directory:canary:github-app-pr"],
      p_lease_duration: "30 minutes",
      p_lease_owner: "github-actions:987654321:1",
      p_merge_policy: "automatic",
    });
  });

  it("uses only the latest persisted state for each fingerprint", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify([
            { fingerprint: "directory:repeat", status: "needs_human" },
            { fingerprint: "directory:repeat", status: "fixed" },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
    );
    const dependencies = createWorkflowRuntimeDependencies({
      env: {
        HEALTH_AGENT_READER_TOKEN: "reader-token",
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
      },
      fetchImplementation,
    });
    const listFingerprintStates = dependencies.queue?.listFingerprintStates;
    if (!listFingerprintStates) throw new Error("queue_state_lookup_missing");

    await expect(listFingerprintStates(["directory:repeat"])).resolves.toEqual([
      { fingerprint: "directory:repeat", status: "needs_human" },
    ]);
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain(
      "order=created_at.desc",
    );
  });

  it("selects ticket candidates by ticketed_at IS NULL on an active row", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify([
            {
              fingerprint: "directory:untitled",
              status: "needs_human",
              ticketed_at: null,
            },
            {
              fingerprint: "directory:untitled",
              status: "needs_human",
              ticketed_at: null,
            },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
    );
    const dependencies = createWorkflowRuntimeDependencies({
      env: {
        HEALTH_AGENT_READER_TOKEN: "reader-token",
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
      },
      fetchImplementation,
    });
    const listUnticketed = dependencies.queue?.listUnticketedFingerprints;
    if (!listUnticketed) throw new Error("queue_ticket_lookup_missing");

    await expect(
      listUnticketed(["directory:untitled", "link:ticketed"]),
    ).resolves.toEqual(["directory:untitled"]);
    const url = String(fetchImplementation.mock.calls[0]?.[0]);
    expect(url).toContain("ticketed_at=is.null");
    expect(url).toContain("select=fingerprint%2Cstatus%2Cticketed_at");
    expect(url).toContain("status=in.%28pending%2Cclaimed");
    expect(url).not.toContain("fixed%2Cskipped");
  });

  it("stamps linear_identifier and ticketed_at through the writer token", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );
    const dependencies = createWorkflowRuntimeDependencies({
      env: {
        HEALTH_AGENT_WRITER_TOKEN: "writer-token",
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
      },
      fetchImplementation,
    });
    const markTicketed = dependencies.queue?.markFingerprintsTicketed;
    if (!markTicketed) throw new Error("queue_ticket_writer_missing");

    await markTicketed(["directory:untitled"], "DEV-1400");

    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(String(url)).toContain("ticketed_at=is.null");
    expect(init?.method).toBe("PATCH");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer writer-token",
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.linear_identifier).toBe("DEV-1400");
    expect(String(body.ticketed_at)).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it("reconciles absent fingerprints through the scoped writer RPC", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify([
            {
              fingerprint: "directory:resolved",
              id: "46591f9f-bbba-4f82-8bee-6b0334f13167",
              reconciliation: "fixed",
            },
            {
              fingerprint: "directory:still-broken",
              id: "77735d6d-c378-4734-b4f7-3d93747c1022",
              reconciliation: "failed_verification",
            },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
    );
    const dependencies = createWorkflowRuntimeDependencies({
      env: {
        HEALTH_AGENT_WRITER_TOKEN: "writer-token",
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
      },
      fetchImplementation,
    });
    const reconcile = dependencies.queue?.reconcileFingerprintLifecycle;
    if (!reconcile) throw new Error("queue_reconciliation_missing");

    await expect(
      reconcile(["directory:current"], ["directory"]),
    ).resolves.toEqual({
      failedVerificationFingerprints: ["directory:still-broken"],
      fixedFingerprints: ["directory:resolved"],
      regressedFingerprints: [],
      verifiedSentryAbsences: [],
    });
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "https://db.example/rest/v1/rpc/reconcile_health_fix_lifecycle",
    );
    expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        p_observed_fingerprints: ["directory:current"],
        p_completed_sources: ["directory"],
      }),
      method: "POST",
    });
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
  it("records an expected human-only escalation without reporting an automation failure", async () => {
    const { files } = repairResultFiles();
    const fetchImplementation = transitionFetch();
    const agentHub = vi.fn(async () => undefined);
    const slack = vi.fn(async () => undefined);
    const input = {
      ...repairFailureInput(),
      expectedEscalation: true,
      reason: "human_action_required_no_repository_patch",
    };

    await deliverRepairFailure(input, {
      delivery: { agentHub, slack },
      env: {
        HEALTH_AGENT_WRITER_TOKEN: "writer-token",
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
      },
      fetchImplementation,
      files,
      linear: { sync: async () => ({ outcomes: [] }) },
    });

    expect(fetchImplementation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining(
          '"p_last_error":"human_action_required_no_repository_patch"',
        ),
      }),
    );
    expect(agentHub).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "needs_human" }),
      }),
    );
    expect(slack).toHaveBeenCalledWith(
      expect.objectContaining({ failures: [] }),
    );
  });

  it("moves claimed findings directly to needs_human without a second Linear sync", async () => {
    const { contents, files } = repairResultFiles();
    const fetchImplementation = transitionFetch();
    const linearSync = vi.fn(async () => ({ outcomes: [] }));
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
    expect(linearSync).not.toHaveBeenCalled();
    expect(agentHub).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          finding_count: automaticRepairFindings.length,
          linear_required: false,
          status: "needs_human",
        }),
      }),
    );
    expect(slack).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: ["repair_validation_failed_after_two_cycles"],
        linearOutcomes: [],
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
    const persistedResult = JSON.parse(persisted);
    expect(persistedResult).toMatchObject({
      agent_hub: "fulfilled",
      claimed_finding_ids: automaticFindingIds,
      linear_outcomes: [],
      merge_policy: "automatic",
      slack: "fulfilled",
      status: "needs_human",
    });
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

  it("selects completed ledger finalization only when required delivery succeeds", async () => {
    const contents = new Map<string, string>();
    const files = {
      read: async (path: string) => contents.get(path) ?? "",
      write: async (path: string, value: string) => {
        contents.set(path, value);
      },
    };

    const successful = await runWorkflowCommand(
      "terminal-status",
      {
        artifactStatus: "success",
        finalReportStatus: "success",
        managerReportStatus: "success",
        outputPath: "terminal-success.json",
        uploadClassifierStatus: "success",
        uploadRetryStatus: "skipped",
        uploadStatus: "success",
      },
      { files },
    );
    const failedUploads = await runWorkflowCommand(
      "terminal-status",
      {
        artifactStatus: "success",
        finalReportStatus: "success",
        managerReportStatus: "success",
        outputPath: "terminal-failed-upload.json",
        uploadClassifierStatus: "success",
        uploadRetryStatus: "failure",
        uploadStatus: "failure",
      },
      { files },
    );
    const failedManagerReport = await runWorkflowCommand(
      "terminal-status",
      {
        artifactStatus: "success",
        finalReportStatus: "success",
        managerReportStatus: "failed",
        outputPath: "terminal-failed-manager-report.json",
        uploadClassifierStatus: "success",
        uploadRetryStatus: "skipped",
        uploadStatus: "success",
      },
      { files },
    );

    expect(successful).toMatchObject({ status: "success" });
    expect(failedUploads).toMatchObject({ status: "failed" });
    expect(failedManagerReport).toMatchObject({ status: "failed" });
    expect(
      JSON.parse(contents.get("terminal-success.json") ?? "{}"),
    ).toMatchObject({ status: "success" });
    expect(
      JSON.parse(contents.get("terminal-failed-upload.json") ?? "{}"),
    ).toMatchObject({ status: "failed" });
    expect(
      JSON.parse(contents.get("terminal-failed-manager-report.json") ?? "{}"),
    ).toMatchObject({
      manager_report_status: "failed",
      status: "failed",
    });
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
            JSON.stringify(
              Array.from({ length: 220 }, (_, index) => ({
                id: `snapshot-${index}`,
                metrics: {
                  database: {
                    connections: { maximum: 100, total: 10 },
                    deadTupleSnapshots: [
                      {
                        snapshotDate:
                          index === 219
                            ? "not-a-date"
                            : `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
                        tables: Array.from(
                          { length: 100 },
                          (_, tableIndex) => ({
                            deadTuplePercent: tableIndex % 2,
                            tableName: `table-${tableIndex}`,
                          }),
                        ),
                      },
                    ],
                  },
                },
                snapshot_date: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
              })),
            ),
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
    expect(directory).toBeDefined();
    const collectedDirectory = directory as DirectoryHealthInput;
    expect(JSON.stringify(directory)).not.toContain("unapproved-brand");
    expect(collectedDirectory.database.deadTupleSnapshots).toHaveLength(2);
    expect(
      collectedDirectory.database.deadTupleSnapshots.map(
        ({ snapshotDate }) => snapshotDate,
      ),
    ).toEqual(["2026-01-28", "2026-07-22"]);

    const contents = new Map([
      ["directory-input.json", JSON.stringify(collectedDirectory)],
    ]);
    await collectDirectoryEvidence(
      {
        inputPath: "directory-input.json",
        outputPath: "directory-evidence.json",
      },
      createWorkflowRuntimeDependencies({
        files: {
          read: async (path) => contents.get(path) ?? "",
          write: async (path, value) => void contents.set(path, value),
        },
      }),
    );
    const serializedEvidence = contents.get("directory-evidence.json");
    expect(serializedEvidence).toBeDefined();
    expect(
      new TextEncoder().encode(serializedEvidence ?? "").byteLength,
    ).toBeLessThan(512 * 1024);
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
    expect(dependencies.queue?.listUnticketedFingerprints).toEqual(
      expect.any(Function),
    );
    expect(dependencies.queue?.markFingerprintsTicketed).toEqual(
      expect.any(Function),
    );
  });

  it("audits ticket-ledger reads and writes at the Supabase boundary", async () => {
    const auditRecords: AuditRecord[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(
      async (_request, init) =>
        new Response(
          init?.method === "PATCH"
            ? JSON.stringify([])
            : JSON.stringify([
                {
                  fingerprint: "directory:one",
                  status: "pending",
                  ticketed_at: null,
                },
              ]),
          { status: 200 },
        ),
    );
    const dependencies = createWorkflowRuntimeDependencies({
      auditRecords,
      env: {
        HEALTH_AGENT_READER_TOKEN: "reader-secret",
        HEALTH_AGENT_WRITER_TOKEN: "writer-secret",
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
      },
      fetchImplementation,
    });

    await dependencies.queue?.listUnticketedFingerprints?.(["directory:one"]);
    await dependencies.queue?.markFingerprintsTicketed?.(
      ["directory:one"],
      "DEV-1404",
    );

    expect(
      auditRecords.map(({ operation, status }) => ({ operation, status })),
    ).toEqual([
      { operation: "list_unticketed_health_fingerprints", status: "success" },
      { operation: "mark_health_fingerprints_ticketed", status: "success" },
    ]);
    expect(JSON.stringify(auditRecords)).not.toContain("reader-secret");
    expect(JSON.stringify(auditRecords)).not.toContain("writer-secret");
  });
});

describe("link collection failure reporting", () => {
  // DEV-1381: a bare `catch {}` reported every cause as the same opaque
  // `link_collection_failed`, so six nights of failures could not be told apart
  // from the uploaded artifact — a network fault, a timeout and an invalid
  // summary all looked identical. The error's class must survive.
  it("keeps the error class in the failure reason", async () => {
    const dir = await mkdtemp(join(tmpdir(), "link-collect-"));
    const outputPath = join(dir, "link-checker.json");

    const artifact = await collectLinkArtifact({
      inputPath: join(dir, "definitely-missing.json"),
      mode: "preflight",
      outputPath,
      runAt: "2026-08-07T00:00:00.000Z",
      workflowAttempt: 1,
      workflowRunId: "test-run",
    });

    expect(artifact.status).toBe("failed");
    expect(artifact.routine).toBe("link-checker");
    // Prefixed with the error class rather than the bare sentinel.
    expect(artifact.failure).toMatch(/^\w+:link_collection_failed$/);
    expect(artifact.failure).not.toBe("link_collection_failed");
    // The reason must never carry a message, path or credential — safeErrorCode
    // returns only `error.name`, and failedCollectorArtifact redacts on top.
    expect(artifact.failure).not.toContain(dir);
    expect(artifact.failure).not.toContain("/");

    await rm(dir, { force: true, recursive: true });
  });
});

describe("sentry triage failure reporting", () => {
  // DEV-1424: a failed Sentry collector and a genuinely clean Sentry both write
  // `issues: []`. The workflow gates classification on `issues | length`, so a
  // thrown collector read as "nothing to classify" and the run died four steps
  // later reporting only `collector_artifact_unavailable`. The two states must
  // be distinguishable, and the real reason must survive to the artifact.
  const runAt = "2026-08-09T23:45:14.000Z";

  async function combine(issues: unknown) {
    const dir = await mkdtemp(join(tmpdir(), "sentry-combine-"));
    const issuesPath = join(dir, "sentry-issues.json");
    const classificationsPath = join(dir, "classifications.json");
    const outputPath = join(dir, "sentry-triage.json");
    await writeFile(issuesPath, JSON.stringify(issues), "utf8");
    await writeFile(classificationsPath, "[]", "utf8");
    const artifact = await combineSentryClassificationArtifact({
      classificationsPath,
      issuesPath,
      mode: "live",
      outputPath,
      runAt,
    });
    await rm(dir, { force: true, recursive: true });
    return artifact;
  }

  const cleanCollection = {
    candidateIssueCount: 0,
    classificationsRequired: 0,
    hasMore: false,
    incidentMode: false,
    issues: [],
    requestCount: 1,
    status: "success",
    version: 1,
  };

  it("treats a genuinely clean Sentry as success", async () => {
    const artifact = await combine(cleanCollection);

    expect(artifact.status).toBe("success");
    expect(artifact.findings).toEqual([]);
    expect(artifact.failures).toEqual([]);
  });

  it("reports the collector's own reason when collection failed", async () => {
    const artifact = await combine({
      ...cleanCollection,
      failure: "sentry_collection_issues_invalid",
      status: "failed",
    });

    expect(artifact.status).toBe("failed");
    // The specific cause, not the generic sentinel that hid this for four days.
    expect(artifact.failures).toEqual(["sentry_collection_issues_invalid"]);
    expect(artifact.failures).not.toContain("collector_artifact_unavailable");
  });

  it("falls back to a stated reason when the collector recorded none", async () => {
    const artifact = await combine({ ...cleanCollection, status: "failed" });

    expect(artifact.status).toBe("failed");
    expect(artifact.failures).toEqual(["sentry_collection_failed"]);
  });
});

describe("link collection audit trail", () => {
  // DEV-1381: executeLinkHealthRequest writes a failure audit carrying the HTTP
  // status, but collectLinkArtifact was the one caller that never passed an
  // audit logger — so emitAudit was a no-op and the workflow's `--audit` file
  // came back empty. That is why an HTTP 401 here looked identical to a
  // malformed response for six consecutive nights.
  it("records the HTTP status when the link-health request is rejected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "link-audit-"));
    const auditRecords: AuditRecord[] = [];

    const fetchImplementation = vi.fn(
      async () =>
        new Response("nope", { status: 401, statusText: "Unauthorized" }),
    ) as unknown as typeof fetch;

    const dependencies = createWorkflowRuntimeDependencies({
      auditRecords,
      env: {
        FORMORIA_LINK_HEALTH_URL: "https://origin.example/api/cron/link-health",
        FORMORIA_LINK_HEALTH_ORIGIN_SECRET: "secret-value",
      },
      fetchImplementation,
    });

    const artifact = await collectLinkArtifact(
      {
        mode: "preflight",
        outputPath: join(dir, "link-checker.json"),
        runAt: "2026-08-07T00:00:00.000Z",
        workflowAttempt: 1,
        workflowRunId: "test-run",
      },
      dependencies,
    );

    expect(artifact.status).toBe("failed");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);

    const linkRecord = auditRecords.find(
      (record) => record.adapter === "link-health",
    );
    expect(
      linkRecord,
      "link-health audit record must be emitted",
    ).toBeDefined();
    expect(linkRecord?.status).toBe("failure");
    expect(
      (linkRecord?.response as Record<string, unknown> | undefined)?.httpStatus,
    ).toBe(401);
    // The credential must never reach the audit trail.
    expect(JSON.stringify(linkRecord)).not.toContain("secret-value");

    await rm(dir, { force: true, recursive: true });
  });
});
