import { describe, expect, it } from "vitest";

import { evaluateQualityReports } from "./quality";

const trackedFiles = new Set([
  "package.json",
  "scripts/agent-hub/health-confirmation-workflow.test.ts",
  "scripts/agent-hub/health-confirmation-workflow.ts",
  "src/lib/services/submissions.ts",
]);

describe("repository health", () => {
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
                ancestorTitles: ["health confirmation workflow contract"],
                failureMessages: [
                  "at /repo/scripts/agent-hub/health-confirmation-workflow.ts:83:28",
                ],
                fullName:
                  "health confirmation workflow contract waits for verification",
                status: "failed",
                title: "waits for verification",
              },
            ],
            name: "/repo/scripts/agent-hub/health-confirmation-workflow.test.ts",
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
      /^quality:full-unit-suite:scripts\/agent-hub\/health-confirmation-workflow\.test\.ts::health-confirmation-workflow-co:[a-f0-9]{16}$/,
    );
    expect(
      result.findings.every(({ mergePolicy }) => mergePolicy === "human"),
    ).toBe(true);
    expect(result.findings[1]?.changedFiles).toEqual([
      "scripts/agent-hub/health-confirmation-workflow.test.ts",
      "scripts/agent-hub/health-confirmation-workflow.ts",
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
            name: "/repo/scripts/agent-hub/health-confirmation-workflow.test.ts",
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
            name: "/repo/scripts/agent-hub/health-confirmation-workflow.test.ts",
            status: "failed",
          },
        ],
      },
    });

    expect(result.status).toBe("success");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      changedFiles: [
        "scripts/agent-hub/health-confirmation-workflow.test.ts",
        "src/lib/services/submissions.ts",
      ],
      fingerprint:
        "quality:full-unit-suite:scripts/agent-hub/health-confirmation-workflow.test.ts::suite-failure",
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
