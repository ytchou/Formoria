import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  KNIP_KNOWN_NOISE,
  KNIP_VERSION,
  isKnownKnipNoise,
} from "./knip-known-noise";
import { evaluateQualityReports } from "./quality";

const trackedFiles = new Set([
  "package.json",
  "scripts/agent-hub/health-agent-workflow.test.ts",
  "scripts/agent-hub/report-run.mjs",
  "src/lib/services/submissions.ts",
]);

describe("repository health", () => {
  it("suppresses only the versioned Knip fixtures and keeps nearby signatures visible", () => {
    const config = readFileSync("knip.json", "utf8");
    expect(KNIP_VERSION).toBe("6.23.0");
    expect(KNIP_KNOWN_NOISE).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "files",
          signature: "src/test/server-only.ts",
        }),
        expect.objectContaining({ kind: "binaries", signature: "tesseract" }),
      ]),
    );
    expect(isKnownKnipNoise("files", "src/test/server-only.ts")).toBe(true);
    expect(isKnownKnipNoise("binaries", "tesseract")).toBe(true);
    expect(config).toContain('"src/test/server-only.ts": ["files"]');
    expect(config).toContain('"ignoreBinaries": ["lsof", "tesseract"]');
    expect(isKnownKnipNoise("files", "src/test/server-only.test.ts")).toBe(
      false,
    );
    expect(isKnownKnipNoise("binaries", "imagemagick")).toBe(false);
  });

  it("drops known-noise findings instead of queuing them as repairs", () => {
    // The suppression list was exported and tested but never consulted by the
    // detector, so false positives reached the repair claim. The repair agent
    // correctly refuses to delete code that is actually used; the refusal then
    // read as a failed repair and blocked the PR (run 31453535132).
    const result = evaluateQualityReports({
      knipExitCode: 1,
      knipReport: {
        issues: [
          {
            exports: [{ name: "resetSentryAdapterForTests" }],
            file: "src/lib/adapters/alerting/sentry.ts",
          },
          {
            exports: [{ name: "getAdminSubmissions" }],
            file: "src/lib/services/submissions.ts",
          },
        ],
      },
      repoRoot: "/repo",
      trackedFiles: new Set([
        ...trackedFiles,
        "src/lib/adapters/alerting/sentry.ts",
      ]),
      vitestExitCode: 0,
      vitestReport: {
        numFailedTestSuites: 0,
        numFailedTests: 0,
        numTotalTestSuites: 1,
        numTotalTests: 1,
        success: true,
        testResults: [],
      },
    });

    const fingerprints = result.findings.map((finding) => finding.fingerprint);
    expect(fingerprints.some((f) => f.includes("getadminsubmissions"))).toBe(
      true,
    );
    expect(
      fingerprints.some((f) => f.includes("resetsentryadapterfortests")),
    ).toBe(false);
    expect(result.failures).not.toContain("dead-code:malformed_output");
  });

  it("scopes noise suppression to the file it was verified in", () => {
    // A bare symbol name is not unique across a repository. An unscoped
    // suppression would hide a genuinely dead export sharing a known-noise
    // name.
    expect(
      isKnownKnipNoise(
        "exports",
        "resetSentryAdapterForTests",
        "src/lib/adapters/alerting/sentry.ts",
      ),
    ).toBe(true);
    expect(
      isKnownKnipNoise(
        "exports",
        "resetSentryAdapterForTests",
        "src/lib/services/impostor.ts",
      ),
    ).toBe(false);
  });

  it("reports manifest-scoped findings without offering them for repair", () => {
    // repair.md forbids the agent from editing dependency manifests, so a
    // manifest-scoped finding can never be repaired by it. Without changedFiles
    // it stays reported and ticketable but never enters the repair claim.
    const result = evaluateQualityReports({
      knipExitCode: 1,
      knipReport: {
        issues: [
          {
            dependencies: [{ name: "@radix-ui/react-accordion" }],
            file: "package.json",
          },
        ],
      },
      repoRoot: "/repo",
      trackedFiles,
      vitestExitCode: 0,
      vitestReport: {
        numFailedTestSuites: 0,
        numFailedTests: 0,
        numTotalTestSuites: 1,
        numTotalTests: 1,
        success: true,
        testResults: [],
      },
    });

    const dependency = result.findings.find((finding) =>
      finding.fingerprint.includes("dependencies:"),
    );
    expect(dependency).toBeDefined();
    expect(dependency?.changedFiles ?? []).toEqual([]);
  });

  it("turns valid Vitest and Knip failures into one complete quality result", () => {
    const result = evaluateQualityReports({
      knipExitCode: 1,
      knipReport: {
        issues: [
          {
            binaries: [],
            exports: [{ name: "getAdminSubmissions" }],
            file: "src/lib/services/submissions.ts",
          },
        ],
      },
      repoRoot: "/repo",
      trackedFiles,
      vitestExitCode: 1,
      vitestReport: {
        numFailedTestSuites: 1,
        numFailedTests: 1,
        numTotalTestSuites: 1,
        numTotalTests: 1,
        success: false,
        testResults: [
          {
            assertionResults: [
              {
                ancestorTitles: ["health agent workflow contract"],
                failureMessages: [
                  "at /repo/scripts/agent-hub/report-run.mjs:83:28",
                ],
                fullName:
                  "health agent workflow contract pins all third-party actions to immutable commits",
                status: "failed",
                title: "pins all third-party actions to immutable commits",
              },
            ],
            name: "/repo/scripts/agent-hub/health-agent-workflow.test.ts",
            status: "failed",
          },
        ],
      },
    });

    expect(result.status).toBe("success");
    expect(result.failures).toEqual([]);
    expect(result.findings[0]?.fingerprint).toBe(
      "quality:dead-code:exports:src/lib/services/submissions.ts:getadminsubmissions",
    );
    expect(result.findings[1]?.fingerprint).toMatch(
      /^quality:full-unit-suite:scripts\/agent-hub\/health-agent-workflow\.test\.ts::health-agent-workflow-contract-pins-al:[a-f0-9]{16}$/,
    );
    expect(
      result.findings.every(({ mergePolicy }) => mergePolicy === "human"),
    ).toBe(true);
    expect(result.findings[1]?.changedFiles).toEqual([
      "scripts/agent-hub/health-agent-workflow.test.ts",
      "scripts/agent-hub/report-run.mjs",
    ]);
  });

  it("fails the group for malformed structured output without hiding the other result", () => {
    const result = evaluateQualityReports({
      knipExitCode: 1,
      knipReport: {
        issues: [
          {
            binaries: [{ name: "lsof" }],
            file: "untracked/generated.ts",
          },
        ],
      },
      repoRoot: "/repo",
      trackedFiles,
      vitestExitCode: 1,
      vitestReport: { success: false },
    });

    expect(result.status).toBe("failed");
    expect(result.failures).toEqual(["full-unit-suite:malformed_output"]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      changedFiles: [],
      fingerprint: "quality:dead-code:binaries:untracked/generated.ts:lsof",
      mergePolicy: "human",
    });
    expect(result.findings[0]?.evidence).toMatchObject({
      repairScopeTrusted: false,
    });
  });

  it("parses knip `duplicates`, which knip reports as an array of symbol groups", () => {
    // Regression for DEV-1381: `duplicates` is the one kind knip nests — each
    // element is the group of symbols sharing a definition, not a single
    // symbol. isRecord() excludes arrays, so before the fix this whole report
    // parsed as null, surfaced as `dead-code:malformed_output`, and failed the
    // nightly health run. Shape copied from a real `pnpm knip --reporter json`.
    const result = evaluateQualityReports({
      knipExitCode: 1,
      knipReport: {
        issues: [
          {
            duplicates: [
              [
                {
                  col: 14,
                  line: 29,
                  name: "MAX_BRAND_IMAGE_SELECTION",
                  pos: 1555,
                },
                { col: 14, line: 39, name: "DRAFT_PARK_SORT_ORDER", pos: 2111 },
              ],
            ],
            file: "src/lib/services/submissions.ts",
          },
        ],
      },
      repoRoot: "/repo",
      trackedFiles,
      vitestExitCode: 0,
      vitestReport: {
        numFailedTestSuites: 0,
        numFailedTests: 0,
        numTotalTestSuites: 1,
        numTotalTests: 1,
        success: true,
        testResults: [],
      },
    });

    expect(result.failures).not.toContain("dead-code:malformed_output");
    const duplicate = result.findings.find((finding) =>
      finding.fingerprint.startsWith("quality:dead-code:"),
    );
    expect(duplicate).toBeDefined();
    // Both members name the group, so the finding stays actionable.
    expect(JSON.stringify(duplicate)).toContain("MAX_BRAND_IMAGE_SELECTION");
    expect(JSON.stringify(duplicate)).toContain("DRAFT_PARK_SORT_ORDER");
  });

  it("keeps long human-readable test names within the queue identity limit", () => {
    const result = evaluateQualityReports({
      knipExitCode: 0,
      knipReport: { issues: [] },
      repoRoot: "/repo",
      trackedFiles,
      vitestExitCode: 1,
      vitestReport: {
        numFailedTestSuites: 1,
        numFailedTests: 1,
        numTotalTestSuites: 1,
        numTotalTests: 1,
        success: false,
        testResults: [
          {
            assertionResults: [
              {
                fullName: `Given a manager ${"with detailed context ".repeat(12)}then reporting remains safe`,
                status: "failed",
              },
            ],
            name: "/repo/scripts/agent-hub/health-agent-workflow.test.ts",
          },
        ],
      },
    });

    expect(result.findings[0]?.fingerprint).toHaveLength(128);
    expect(result.findings[0]?.fingerprint).toMatch(/:[a-f0-9]{16}$/);
  });

  it("reports an import-time suite crash as a repairable finding", () => {
    const result = evaluateQualityReports({
      knipExitCode: 0,
      knipReport: { issues: [] },
      repoRoot: "/repo",
      trackedFiles,
      vitestExitCode: 1,
      vitestReport: {
        numFailedTestSuites: 1,
        numFailedTests: 0,
        numTotalTestSuites: 1,
        numTotalTests: 0,
        success: false,
        testResults: [
          {
            assertionResults: [],
            message:
              "Failed to load module at /repo/src/lib/services/submissions.ts:7:1",
            name: "/repo/scripts/agent-hub/health-agent-workflow.test.ts",
            status: "failed",
          },
        ],
      },
    });

    expect(result.status).toBe("success");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      changedFiles: [
        "scripts/agent-hub/health-agent-workflow.test.ts",
        "src/lib/services/submissions.ts",
      ],
      fingerprint:
        "quality:full-unit-suite:scripts/agent-hub/health-agent-workflow.test.ts::suite-failure",
      mergePolicy: "human",
      severity: "high",
    });
  });

  it("rejects a normalized path that escapes the repository", () => {
    const result = evaluateQualityReports({
      knipExitCode: 1,
      knipReport: {
        issues: [
          {
            exports: [{ name: "leakedSymbol" }],
            file: "scripts/../../outside.ts",
          },
        ],
      },
      repoRoot: "/repo",
      trackedFiles,
      vitestExitCode: 0,
      vitestReport: {
        numFailedTestSuites: 0,
        numFailedTests: 0,
        numTotalTestSuites: 1,
        numTotalTests: 1,
        success: true,
        testResults: [],
      },
    });

    expect(result.findings[0]).toMatchObject({
      changedFiles: [],
      fingerprint: "quality:dead-code:exports:package.json:leakedsymbol",
    });
  });
});
