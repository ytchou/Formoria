import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RepairFinding, RepairCycleReport } from "./repair";
import {
  AUTOMATIC_CONFIDENCE_THRESHOLD,
  buildRepairBranchName,
  buildRepairPrBody,
  clusterRepairFindings,
  decideRepairPolicy,
  evaluateRepairCycles,
  partitionRepairBatch,
  snapshotClaimedFindings,
} from "./repair";

function finding(overrides: Partial<RepairFinding> = {}): RepairFinding {
  return {
    behaviorChangeRisk: "low",
    changedFiles: ["src/cart/cart-service.ts"],
    confidence: 0.95,
    defectKind: "application",
    evidence: {
      artifactPath: "/tmp/health-agent/sanitized-cart.json",
    },
    evidenceArtifactRef: "/tmp/health-agent/sanitized-cart.json",
    fingerprint: "sentry:issue:cart-1",
    mergePolicy: "automatic",
    reproducible: true,
    rootCauseKey: "cart-missing-item",
    severity: "high",
    source: "sentry",
    title: "Cart service handles a missing item incorrectly",
    ...overrides,
  };
}

function passedCycle(cycle: 1 | 2): RepairCycleReport {
  return {
    cycle,
    reviewState: "passed",
    validationState: "passed",
  };
}

describe("health repair snapshot and partition policy", () => {
  it("snapshots exactly the claimed findings and is isolated from later input changes", () => {
    const claimed = [
      finding({ fingerprint: "sentry:issue:one" }),
      finding({ fingerprint: "sentry:issue:two" }),
      finding({ fingerprint: "sentry:issue:three" }),
      finding({ fingerprint: "sentry:issue:four" }),
    ];
    const snapshot = snapshotClaimedFindings(claimed);

    claimed.push(finding({ fingerprint: "sentry:issue:later" }));
    const first = claimed.at(0);
    if (!first) throw new Error("test fixture is empty");
    first.evidence.artifactPath = "/tmp/changed-after-snapshot.json";
    const changedFiles = first.changedFiles;
    if (changedFiles) {
      (changedFiles as string[]).push("src/later.ts");
    }

    const partition = partitionRepairBatch(snapshot);
    expect(snapshot.findings).toHaveLength(4);
    expect(partition.automatic.findings).toHaveLength(4);
    expect(partition.human.findings).toHaveLength(0);
    expect(partition.automatic.findings.at(0)?.evidenceArtifactRef).toBe(
      "/tmp/health-agent/sanitized-cart.json",
    );
    expect(partition.automatic.findings.at(0)?.changedFiles).toEqual([
      "src/cart/cart-service.ts",
    ]);
  });

  it("clusters duplicates by root-cause key while retaining finding traceability", () => {
    const duplicates = [
      finding({
        fingerprint: "sentry:issue:two",
        source: "sentry",
        evidenceArtifactRef: "/tmp/evidence/two.json",
        changedFiles: ["src/cart/cart-service.ts"],
      }),
      finding({
        fingerprint: "link:broken:cart",
        source: "link",
        evidenceArtifactRef: "/tmp/evidence/cart-link.json",
        changedFiles: ["src/cart/cart-link.ts"],
      }),
    ];

    const [cluster] = clusterRepairFindings(duplicates);
    expect(cluster).toBeDefined();
    expect(cluster?.rootCauseKey).toBe("cart-missing-item");
    expect(cluster?.fingerprints).toEqual([
      "link:broken:cart",
      "sentry:issue:two",
    ]);
    expect(cluster?.sources).toEqual(["link", "sentry"]);
    expect(cluster?.evidenceArtifactRefs).toEqual([
      "/tmp/evidence/cart-link.json",
      "/tmp/evidence/two.json",
    ]);
    expect(cluster?.traceability).toEqual([
      {
        changedFiles: ["src/cart/cart-link.ts"],
        evidenceArtifactRef: "/tmp/evidence/cart-link.json",
        fingerprint: "link:broken:cart",
        source: "link",
      },
      {
        changedFiles: ["src/cart/cart-service.ts"],
        evidenceArtifactRef: "/tmp/evidence/two.json",
        fingerprint: "sentry:issue:two",
        source: "sentry",
      },
    ]);
  });

  it("does not mix batches and has no finding cap", () => {
    const automatic = Array.from({ length: 7 }, (_, index) =>
      finding({
        fingerprint: `sentry:issue:auto-${index}`,
        rootCauseKey: `auto-${index}`,
      }),
    );
    const human = [
      finding({
        fingerprint: "sentry:issue:critical",
        rootCauseKey: "critical-root",
        severity: "critical",
      }),
      finding({
        fingerprint: "directory:dependabot:major",
        rootCauseKey: "dependency-major",
        defectKind: "dependency",
        dependencyImpact: "major",
        mergePolicy: "automatic",
      }),
    ];
    const snapshot = snapshotClaimedFindings([...automatic, ...human]);
    const partition = partitionRepairBatch(snapshot);

    expect(partition.automatic.findings).toHaveLength(7);
    expect(partition.human.findings).toHaveLength(2);
    expect(
      new Set([
        ...partition.automatic.findings.map(({ fingerprint }) => fingerprint),
        ...partition.human.findings.map(({ fingerprint }) => fingerprint),
      ]),
    ).toEqual(new Set(snapshot.findings.map(({ fingerprint }) => fingerprint)));
    expect(
      partition.automatic.findings.every(
        ({ fingerprint }) =>
          !partition.human.findings.some(
            (humanFinding) => humanFinding.fingerprint === fingerprint,
          ),
      ),
    ).toBe(true);
  });

  it("moves every duplicate cluster to human when one member is not automatic", () => {
    const partition = partitionRepairBatch(
      snapshotClaimedFindings([
        finding({ fingerprint: "sentry:issue:eligible" }),
        finding({
          fingerprint: "sentry:issue:workflow",
          changedFiles: [".github/workflows/health.yml"],
        }),
      ]),
    );

    expect(partition.automatic.findings).toHaveLength(0);
    expect(partition.human.findings).toHaveLength(2);
    expect(partition.human.clusters).toHaveLength(1);
    expect(
      partition.human.findingPolicies.every(
        ({ effectiveMergePolicy }) => effectiveMergePolicy === "human",
      ),
    ).toBe(true);
  });
});

describe("health repair eligibility gates", () => {
  it("uses the same high-confidence threshold as the Sentry policy", () => {
    expect(AUTOMATIC_CONFIDENCE_THRESHOLD).toBe(0.8);
    expect(decideRepairPolicy(finding({ confidence: 0.8 })).mergePolicy).toBe(
      "automatic",
    );
    expect(decideRepairPolicy(finding({ confidence: 0.79 })).mergePolicy).toBe(
      "human",
    );
  });

  it.each([
    ["critical severity", { severity: "critical" as const }],
    ["not reproducible", { reproducible: false }],
    ["behavior risk", { behaviorChangeRisk: "medium" as const }],
    ["human request", { mergePolicy: "human" as const }],
    ["workflow path", { changedFiles: [".github/workflows/health.yml"] }],
    ["authentication path", { changedFiles: ["src/auth/session.ts"] }],
    ["permissions path", { changedFiles: ["src/permissions/role-policy.ts"] }],
    ["migration path", { changedFiles: ["supabase/migrations/0001.sql"] }],
    ["merge policy change", { changesMergePolicy: true }],
    ["validation weakening", { validationWeakening: true }],
  ])("forces human policy for %s", (_label, overrides) => {
    const decision = decideRepairPolicy(finding(overrides));
    expect(decision.mergePolicy).toBe("human");
    expect(decision.automaticEligible).toBe(false);
    expect(decision.reasons.length).toBeGreaterThan(0);
  });

  it("keeps patch and minor dependencies batchable but waits for validation before auto-merge", () => {
    const patch = finding({
      defectKind: "dependency",
      dependencyImpact: "patch",
      fingerprint: "directory:dependabot:patch",
      rootCauseKey: "dependency-patch",
    });
    const minor = finding({
      defectKind: "dependency",
      dependencyImpact: "minor",
      fingerprint: "directory:dependabot:minor",
      rootCauseKey: "dependency-minor",
    });

    expect(decideRepairPolicy(patch).mergePolicy).toBe("automatic");
    expect(decideRepairPolicy(minor).mergePolicy).toBe("automatic");

    const partition = partitionRepairBatch(
      snapshotClaimedFindings([patch, minor]),
    );
    const result = evaluateRepairCycles(partition.automatic, [passedCycle(1)]);
    expect(result.autoMergeEnabled).toBe(true);
    expect(result.autoMergeEligible).toBe(true);
    expect(result.merged).toBe(false);
  });

  it("forces major and unknown dependency impact to human", () => {
    for (const dependencyImpact of ["major", "unknown"] as const) {
      expect(
        decideRepairPolicy(
          finding({
            defectKind: "dependency",
            dependencyImpact,
            fingerprint: `directory:dependabot:${dependencyImpact}`,
          }),
        ).mergePolicy,
      ).toBe("human");
    }
  });
});

describe("two-cycle repair/review policy", () => {
  it("requires a retry after a first combined failure", () => {
    const partition = partitionRepairBatch(
      snapshotClaimedFindings([finding()]),
    );
    const result = evaluateRepairCycles(partition.automatic, [
      { cycle: 1, reviewState: "failed", validationState: "passed" },
    ]);

    expect(result.status).toBe("retry_required");
    expect(result.fixed).toBe(false);
    expect(result.merged).toBe(false);
    expect(result.linearRequired).toBe(false);
    expect(result.autoMergeEligible).toBe(false);
  });

  it.each([
    { reviewState: "failed" as const, validationState: "passed" as const },
    { reviewState: "passed" as const, validationState: "failed" as const },
  ])("escalates every finding after a second failed cycle", (cycleTwo) => {
    const findings = [
      finding({ fingerprint: "sentry:issue:one", rootCauseKey: "one" }),
      finding({ fingerprint: "sentry:issue:two", rootCauseKey: "two" }),
    ];
    const partition = partitionRepairBatch(snapshotClaimedFindings(findings));
    const result = evaluateRepairCycles(partition.automatic, [
      passedCycle(1),
      { cycle: 2, ...cycleTwo },
    ]);

    expect(result.status).toBe("needs_human");
    expect(result.linearRequired).toBe(true);
    expect(result.fixed).toBe(false);
    expect(result.merged).toBe(false);
    expect(result.autoMergeEnabled).toBe(false);
    expect(result.autoMergeEligible).toBe(false);
    expect(result.findings).toHaveLength(2);
    expect(
      result.findings.every(({ status }) => status === "needs_human"),
    ).toBe(true);
  });

  it("allows the second cycle to recover, while keeping auto-merge distinct from merged", () => {
    const partition = partitionRepairBatch(
      snapshotClaimedFindings([finding()]),
    );
    const result = evaluateRepairCycles(partition.automatic, [
      { cycle: 1, reviewState: "failed", validationState: "failed" },
      passedCycle(2),
    ]);
    const merged = evaluateRepairCycles(partition.automatic, [passedCycle(1)], {
      merged: true,
    });

    expect(result.status).toBe("ready_to_merge");
    expect(result.fixed).toBe(true);
    expect(result.autoMergeEnabled).toBe(true);
    expect(result.autoMergeEligible).toBe(true);
    expect(result.merged).toBe(false);
    expect(merged.status).toBe("merged");
    expect(merged.autoMergeEnabled).toBe(true);
    expect(merged.merged).toBe(true);
  });

  it("rejects cycles beyond two and rejects per-finding additions after the snapshot", () => {
    const partition = partitionRepairBatch(
      snapshotClaimedFindings([finding()]),
    );

    expect(() =>
      evaluateRepairCycles(partition.automatic, [
        passedCycle(1),
        passedCycle(2),
        {
          cycle: 2,
          reviewState: "passed",
          validationState: "passed",
        },
      ]),
    ).toThrow("at most two");

    expect(() =>
      evaluateRepairCycles(partition.automatic, [
        {
          cycle: 1,
          reviewState: "passed",
          validationState: "passed",
          findingStates: [
            {
              fingerprint: "sentry:issue:later",
              reviewState: "passed",
              validationState: "passed",
            },
          ],
        },
      ]),
    ).toThrow("snapshot");
  });

  it("keeps human batches human even after a passing repair and review", () => {
    const partition = partitionRepairBatch(
      snapshotClaimedFindings([
        finding({
          changedFiles: [".github/workflows/health.yml"],
          fingerprint: "sentry:issue:workflow",
        }),
      ]),
    );
    const result = evaluateRepairCycles(partition.human, [passedCycle(1)]);

    expect(result.status).toBe("awaiting_human");
    expect(result.linearRequired).toBe(true);
    expect(result.autoMergeEnabled).toBe(false);
    expect(result.autoMergeEligible).toBe(false);
    expect(result.merged).toBe(false);
  });
});

describe("deterministic repair branches and PR bodies", () => {
  it("uses the same branch and body for the same snapshot regardless of input order", () => {
    const first = finding({
      fingerprint: "sentry:issue:first",
      rootCauseKey: "shared-root",
      evidenceArtifactRef: "/private/secret/sanitized-first.json",
      changedFiles: ["src/z.ts"],
    });
    const second = finding({
      fingerprint: "link:broken:second",
      rootCauseKey: "shared-root",
      source: "link",
      evidenceArtifactRef: "/private/secret/sanitized-second.json",
      changedFiles: ["src/a.ts"],
    });
    const firstResult = evaluateRepairCycles(
      partitionRepairBatch(snapshotClaimedFindings([first, second])).automatic,
      [passedCycle(1)],
    );
    const secondResult = evaluateRepairCycles(
      partitionRepairBatch(snapshotClaimedFindings([second, first])).automatic,
      [passedCycle(1)],
    );

    expect(
      buildRepairBranchName(
        partitionRepairBatch(snapshotClaimedFindings([first, second]))
          .automatic,
      ),
    ).toBe(
      buildRepairBranchName(
        partitionRepairBatch(snapshotClaimedFindings([second, first]))
          .automatic,
      ),
    );
    expect(buildRepairPrBody(firstResult)).toBe(
      buildRepairPrBody(secondResult),
    );
  });

  it("renders every traceability field and never exposes the evidence path", () => {
    const batch = partitionRepairBatch(
      snapshotClaimedFindings([
        finding({
          evidenceArtifactRef: "/private/secret/sanitized-cart.json",
          fingerprint: "sentry:issue:traceable",
          changedFiles: ["src/cart/cart-service.ts", "src/cart/cart.test.ts"],
        }),
      ]),
    ).automatic;
    const result = evaluateRepairCycles(batch, [passedCycle(1)]);
    const body = buildRepairPrBody(result);

    expect(body).toContain("merge_policy: automatic");
    expect(body).toContain("auto_merge_enabled: true");
    expect(body).toContain("auto_merge_eligible: true");
    expect(body).toContain("merged: false");
    expect(body).toContain("fingerprint: `sentry:issue:traceable`");
    expect(body).toContain("source: `sentry`");
    expect(body).toContain("root_cause_key: `cart-missing-item`");
    expect(body).toContain(
      "evidence_artifact_ref: `[redacted]/sanitized-cart.json`",
    );
    expect(body).toContain("changed_file_mapping:");
    expect(body).toContain("`src/cart/cart-service.ts`");
    expect(body).toContain("`src/cart/cart.test.ts`");
    expect(body).toContain("validation_state: passed");
    expect(body).toContain("review_state: passed");
    expect(body).not.toContain("/private/secret");
  });
});

describe("isolated health-agent prompts", () => {
  it("requires repair evidence by file path and a narrow edit allowlist", () => {
    const prompt = readFileSync(".github/health-agent/repair.md", "utf8");

    expect(prompt).toContain("sanitized_evidence_path");
    expect(prompt).toContain("Read, Glob, Grep, Edit, Write");
    expect(prompt).toContain("no network");
    expect(prompt).toContain("no MCP");
    expect(prompt).toContain("no production credentials");
    expect(prompt).toContain("no GitHub tokens");
    expect(prompt).toContain("at most two");
    expect(prompt).toContain("fingerprint");
    expect(prompt).toContain("changed_files");
    expect(prompt).not.toContain("{{");
    expect(prompt).not.toContain("${");
  });

  it("keeps review independent and read-only", () => {
    const prompt = readFileSync(".github/health-agent/review.md", "utf8");

    expect(prompt).toContain("independent");
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("sanitized_evidence_path");
    expect(prompt).toContain("Read, Glob, Grep");
    expect(prompt).not.toContain("Edit");
    expect(prompt).not.toContain("Write");
    expect(prompt).toContain("no network");
    expect(prompt).toContain("no MCP");
    expect(prompt).toContain("no production credentials");
    expect(prompt).toContain("no GitHub tokens");
    expect(prompt).toContain("fingerprint");
    expect(prompt).toContain("validation_state");
  });
});
