import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import type { DirectoryHealthInput } from "./directory";
import {
  createRpcClient,
  createWorkflowRuntimeDependencies,
  deliverRepairResult,
  finalizeSentryArtifact,
  makeDirectoryArtifact,
  makeLinkArtifact,
  type RepairResultInput,
} from "./workflow-runtime";

const now = "2026-07-22T00:00:00.000Z";
const automaticFindingIds = [
  "e490b9bc-006f-46b9-9838-91f19fbdaf29",
  "77735d6d-c378-4734-b4f7-3d93747c1022",
];
const humanFindingIds = ["2437fd75-9edc-4e70-815d-a578d4886234"];

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

function repairResultFiles() {
  const contents = new Map<string, string>([
    [
      "repair-metadata.json",
      JSON.stringify({
        automatic: { claimed_finding_ids: automaticFindingIds },
        human: { claimed_finding_ids: humanFindingIds },
      }),
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
