import { describe, expect, it } from "vitest";
import {
  classifyInfrastructure,
  evaluateSelfMerge,
  freezeFailures,
  nextIncidentState,
  renderIncidentPrBody,
  terminalOutcome,
  validateDiagnosis,
  validateRepair,
  type DiagnosisResult,
} from "./incident";

const frozen = freezeFailures([
  {
    file: "e2e/tests/search.spec.ts",
    project: "deep",
    title: "María García can search 台灣茶",
  },
  {
    file: "e2e/tests/mobile.spec.ts",
    project: "mobile",
    title: "María García can search 台灣茶",
  },
]);

const diagnosis = (
  overrides: Partial<DiagnosisResult> = {},
): DiagnosisResult => ({
  version: 1,
  failureSetHash: frozen.failureSetHash,
  failures: frozen.failures.map((failure) => ({
    ...failure,
    category: "test-drift",
    rootCauseKey: "search-copy",
    actionable: true,
    reason: "The public label intentionally changed.",
  })),
  clusters: [
    {
      rootCauseKey: "search-copy",
      failureIds: frozen.failures.map(({ id }) => id),
      category: "test-drift",
      actionable: true,
      plannedFiles: ["e2e/tests/search.spec.ts", "e2e/tests/mobile.spec.ts"],
      diagnosis: "Both projects assert the old label.",
      repairPlan: "Update both assertions to the current accessible name.",
    },
  ],
  complete: true,
  ...overrides,
});

describe("self-heal incident contracts", () => {
  it("requires every frozen failure exactly once while allowing a shared cluster", () => {
    expect(validateDiagnosis(frozen, diagnosis()).clusters).toHaveLength(1);
    expect(() =>
      validateDiagnosis(
        frozen,
        diagnosis({ failures: diagnosis().failures.slice(0, 1) }),
      ),
    ).toThrow("exactly once");
    expect(() =>
      validateDiagnosis(frozen, {
        ...diagnosis(),
        failures: [...diagnosis().failures, diagnosis().failures[0]!],
      }),
    ).toThrow("exactly once");
  });

  it("fails closed for incomplete diagnosis, invented IDs, and hash drift", () => {
    expect(() =>
      validateDiagnosis(frozen, diagnosis({ complete: false })),
    ).toThrow("complete");
    expect(() =>
      validateDiagnosis(frozen, {
        ...diagnosis(),
        failures: diagnosis().failures.map((failure, index) =>
          index === 0 ? { ...failure, id: "invented" } : failure,
        ),
      }),
    ).toThrow("exactly once");
    expect(() =>
      validateDiagnosis(frozen, diagnosis({ failureSetHash: "stale" })),
    ).toThrow("hash");
  });

  it("requires every actionable root cause and the exact working-tree paths", () => {
    expect(
      validateRepair(
        diagnosis(),
        {
          version: 1,
          failureSetHash: frozen.failureSetHash,
          addressedFailureIds: frozen.failures.map(({ id }) => id),
          addressedRootCauseKeys: ["search-copy"],
          changedFiles: [
            "e2e/tests/mobile.spec.ts",
            "e2e/tests/search.spec.ts",
          ],
          summary: "Updated both stale labels.",
          remainingWork: [],
          complete: true,
        },
        ["e2e/tests/search.spec.ts", "e2e/tests/mobile.spec.ts"],
      ).complete,
    ).toBe(true);
    expect(() =>
      validateRepair(
        diagnosis(),
        {
          version: 1,
          failureSetHash: frozen.failureSetHash,
          addressedFailureIds: frozen.failures.map(({ id }) => id),
          addressedRootCauseKeys: [],
          changedFiles: ["e2e/tests/search.spec.ts"],
          summary: "Partial repair.",
          remainingWork: [],
          complete: true,
        },
        ["e2e/tests/search.spec.ts"],
      ),
    ).toThrow("actionable cluster");
    expect(() =>
      validateRepair(
        diagnosis(),
        {
          version: 1,
          failureSetHash: frozen.failureSetHash,
          addressedFailureIds: frozen.failures.map(({ id }) => id),
          addressedRootCauseKeys: ["search-copy"],
          changedFiles: ["e2e/tests/search.spec.ts"],
          summary: "Declared only one file.",
          remainingWork: [],
          complete: true,
        },
        ["e2e/tests/search.spec.ts", "e2e/tests/mobile.spec.ts"],
      ),
    ).toThrow("working tree");
  });

  it("allows only drift-only TypeScript E2E changes with no weakening", () => {
    const safe = evaluateSelfMerge({
      diagnosis: diagnosis(),
      changedFiles: ["e2e/tests/search.spec.ts"],
      deletedOrRenamedSpecs: [],
      addedLines: ["await expect(result).toHaveText('台灣茶')"],
      testCountBefore: 12,
      testCountAfter: 12,
      assertionCountBefore: 20,
      assertionCountAfter: 20,
      skippedBefore: 1,
      skippedAfter: 1,
    });
    expect(safe).toEqual({ eligible: true, reasons: [] });

    const unsafe = evaluateSelfMerge({
      diagnosis: diagnosis(),
      changedFiles: ["src/app/page.tsx", "e2e/tests/search.spec.ts"],
      deletedOrRenamedSpecs: ["e2e/tests/legacy.spec.ts"],
      addedLines: ["test.skip();", "test.setTimeout(60_000);"],
      testCountBefore: 12,
      testCountAfter: 11,
      assertionCountBefore: 20,
      assertionCountAfter: 19,
      skippedBefore: 1,
      skippedAfter: 2,
    });
    expect(unsafe.eligible).toBe(false);
    expect(unsafe.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unsafe changed path"),
        expect.stringContaining("deleted or renamed"),
        expect.stringContaining("test.skip"),
        expect.stringContaining("test count"),
        expect.stringContaining("assertion count"),
        expect.stringContaining("skipped-test count"),
      ]),
    );
  });

  it("fails self-merge closed when validated diagnosis evidence is unavailable", () => {
    const eligibility = evaluateSelfMerge({
      changedFiles: ["src/proxy.ts"],
      deletedOrRenamedSpecs: [],
      addedLines: [],
      testCountBefore: 10,
      testCountAfter: 10,
      assertionCountBefore: 20,
      assertionCountAfter: 20,
      skippedBefore: 0,
      skippedAfter: 0,
    });

    expect(eligibility).toEqual({
      eligible: false,
      reasons: [
        "unsafe changed path: src/proxy.ts",
        "validated diagnosis is unavailable",
      ],
    });
  });

  it("separates infrastructure retries from repair and base-sync caps", () => {
    expect(
      nextIncidentState(
        { repairCycle: 1, infrastructureRetries: 0, baseSyncAttempts: 0 },
        "infrastructure_retry",
      ),
    ).toEqual({
      repairCycle: 1,
      infrastructureRetries: 1,
      baseSyncAttempts: 0,
    });
    expect(() =>
      nextIncidentState(
        { repairCycle: 1, infrastructureRetries: 2, baseSyncAttempts: 0 },
        "infrastructure_retry",
      ),
    ).toThrow("infrastructure retry limit");
    expect(() =>
      nextIncidentState(
        { repairCycle: 3, infrastructureRetries: 0, baseSyncAttempts: 0 },
        "repair_cycle",
      ),
    ).toThrow("repair cycle limit");
    expect(() =>
      nextIncidentState(
        { repairCycle: 1, infrastructureRetries: 0, baseSyncAttempts: 2 },
        "base_sync",
      ),
    ).toThrow("base-sync limit");
  });

  it("requires a failed authenticated probe or strong service signatures", () => {
    expect(
      classifyInfrastructure({
        errors: ["PostgREST schema cache is unavailable"],
        probe: { authenticated: true, ok: false, status: 503 },
      }).confirmed,
    ).toBe(true);
    expect(
      classifyInfrastructure({
        errors: [],
        probe: { authenticated: false, ok: false, status: 401 },
      }).confirmed,
    ).toBe(false);
    expect(
      classifyInfrastructure({
        errors: ["Expected heading to be visible"],
        probe: { authenticated: true, ok: true, status: 200 },
      }).confirmed,
    ).toBe(false);
    expect(
      classifyInfrastructure({
        errors: [
          "upstream connect error or disconnect/reset before headers",
          "Could not query the database for the schema cache (PGRST002)",
          "Timed out acquiring connection from connection pool (PGRST003)",
        ],
        probe: { authenticated: true, ok: true, status: 200 },
      }).confirmed,
    ).toBe(true);
  });

  it("ignores stale outage signatures when a continuation probe is healthy", () => {
    expect(
      classifyInfrastructure({
        errors: [
          "upstream connect error or disconnect/reset before headers",
          "Timed out acquiring connection from connection pool (PGRST003)",
        ],
        errorsCurrent: false,
        probe: { authenticated: true, ok: true, status: 200 },
      }),
    ).toEqual({ confirmed: false, reasons: [] });
  });

  it("renders all incident evidence and chooses terminal outcomes", () => {
    const body = renderIncidentPrBody({
      rootIncidentId: "nightly-991",
      rootWorkflowUrl: "https://github.test/actions/991",
      currentWorkflowUrl: "https://github.test/actions/993",
      frozen,
      diagnosis: diagnosis(),
      cycles: [
        {
          cycle: 1,
          commit: "abc123",
          changedFiles: ["e2e/tests/search.spec.ts"],
        },
      ],
      exactValidation: "passed",
      fullValidation: "passed",
      infrastructureRetries: 1,
      remainingFailures: [],
      mergeEligibility: { eligible: true, reasons: [] },
      terminalOutcome: "merged",
    });
    expect(body).toContain("nightly-991");
    expect(body).toContain("search-copy");
    expect(body).toContain("abc123");
    expect(body).toContain("Infrastructure retries: 1/2");
    expect(body).toContain("Terminal outcome: `merged`");

    expect(terminalOutcome({ infrastructureBlocked: true })).toBe(
      "infrastructure_blocked",
    );
    expect(terminalOutcome({ merged: true })).toBe("merged");
    expect(terminalOutcome({ recoveredNoChange: true })).toBe(
      "recovered_no_change",
    );
    expect(terminalOutcome({ reviewReady: true })).toBe("review_ready");
    expect(terminalOutcome({ repairBlocked: true, recoveredNoChange: true })).toBe(
      "repair_blocked",
    );
    expect(terminalOutcome({})).toBe("repair_blocked");
  });
});
