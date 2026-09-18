import { describe, expect, it } from "vitest";
import {
  collectSkipped,
  unexpectedSkips,
  type ExpectedSkipManifest,
} from "@/lib/services/e2e-report/gate";
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
} from "@/lib/services/e2e-selfheal/incident";

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

describe("freezeFailures_hashes_and_deduplicates", () => {
  it("produces unique fingerprints per canonical failure", () => {
    const set = freezeFailures([
      { file: "e2e/a.spec.ts", project: "deep", title: "test A" },
      { file: "e2e/b.spec.ts", project: "deep", title: "test B" },
    ]);
    expect(set.failures).toHaveLength(2);
    const ids = set.failures.map(({ id }) => id);
    expect(new Set(ids).size).toBe(2);
    expect(set.failureSetHash).toBeTruthy();
  });

  it("throws on duplicate source failures", () => {
    expect(() =>
      freezeFailures([
        { file: "e2e/a.spec.ts", project: "deep", title: "test A" },
        { file: "e2e/a.spec.ts", project: "deep", title: "test A" },
      ]),
    ).toThrow("duplicate");
  });

  it("throws on empty input", () => {
    expect(() => freezeFailures([])).toThrow("empty");
  });
});

describe("validateDiagnosis_rejects_invalid_schema", () => {
  it("rejects incomplete diagnosis", () => {
    expect(() =>
      validateDiagnosis(frozen, diagnosis({ complete: false })),
    ).toThrow("complete");
  });

  it("rejects mismatched failure-set hash", () => {
    expect(() =>
      validateDiagnosis(frozen, diagnosis({ failureSetHash: "stale" })),
    ).toThrow("hash");
  });

  it("rejects invented failure IDs", () => {
    expect(() =>
      validateDiagnosis(frozen, {
        ...diagnosis(),
        failures: diagnosis().failures.map((failure, index) =>
          index === 0 ? { ...failure, id: "invented" } : failure,
        ),
      }),
    ).toThrow("exactly once");
  });

  it("rejects unsupported version", () => {
    expect(() =>
      validateDiagnosis(frozen, { ...diagnosis(), version: 2 as 1 }),
    ).toThrow("version");
  });
});

describe("evaluateSelfMerge_rejects_deleted_tests", () => {
  it("rejects when specs are deleted or renamed", () => {
    const result = evaluateSelfMerge({
      diagnosis: diagnosis(),
      changedFiles: ["e2e/tests/search.spec.ts"],
      deletedOrRenamedSpecs: ["e2e/tests/legacy.spec.ts"],
      addedLines: [],
      testCountBefore: 12,
      testCountAfter: 12,
      assertionCountBefore: 20,
      assertionCountAfter: 20,
      skippedBefore: 1,
      skippedAfter: 1,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("deleted or renamed")]),
    );
  });

  it("rejects reduced test count", () => {
    const result = evaluateSelfMerge({
      diagnosis: diagnosis(),
      changedFiles: ["e2e/tests/search.spec.ts"],
      deletedOrRenamedSpecs: [],
      addedLines: [],
      testCountBefore: 12,
      testCountAfter: 11,
      assertionCountBefore: 20,
      assertionCountAfter: 20,
      skippedBefore: 1,
      skippedAfter: 1,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("test count")]),
    );
  });

  it("accepts safe drift-only changes", () => {
    const result = evaluateSelfMerge({
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
    expect(result).toEqual({ eligible: true, reasons: [] });
  });
});

describe("collectSkipped_extracts_from_playwright_json", () => {
  it("extracts skipped tests from a Playwright JSON report", () => {
    const report = {
      suites: [
        {
          file: "e2e/tests/smoke.spec.ts",
          title: "",
          suites: [],
          specs: [
            {
              title: "homepage loads",
              tests: [
                {
                  projectName: "deep",
                  status: "skipped",
                  results: [{ status: "skipped" }],
                  annotations: [
                    { type: "skip", description: "auth quota hit" },
                  ],
                },
              ],
            },
            {
              title: "passing test",
              tests: [
                {
                  projectName: "deep",
                  status: "expected",
                  results: [{ status: "passed" }],
                  annotations: [],
                },
              ],
            },
          ],
        },
      ],
      stats: { skipped: 1 },
    };
    const skipped = collectSkipped(report);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      file: "e2e/tests/smoke.spec.ts",
      title: "homepage loads",
      project: "deep",
    });
    expect(skipped[0]!.reason).toContain("auth quota hit");
  });

  it("returns empty for a clean report", () => {
    const report = {
      suites: [
        {
          file: "e2e/tests/smoke.spec.ts",
          title: "",
          suites: [],
          specs: [
            {
              title: "passing",
              tests: [
                {
                  projectName: "deep",
                  status: "expected",
                  results: [{ status: "passed" }],
                  annotations: [],
                },
              ],
            },
          ],
        },
      ],
      stats: { skipped: 0 },
    };
    expect(collectSkipped(report)).toHaveLength(0);
  });
});

describe("unexpectedSkips_filters_against_manifest", () => {
  const manifest: ExpectedSkipManifest = {
    version: 1,
    allowed: [
      { file: "smoke.spec.ts", title: "homepage loads" },
    ],
  };

  it("removes expected skips from the result", () => {
    const report = {
      suites: [
        {
          file: "e2e/tests/smoke.spec.ts",
          title: "",
          suites: [],
          specs: [
            {
              title: "homepage loads",
              tests: [
                {
                  projectName: "deep",
                  status: "skipped",
                  results: [{ status: "skipped" }],
                  annotations: [],
                },
              ],
            },
          ],
        },
      ],
      stats: { skipped: 1 },
    };
    expect(unexpectedSkips(report, manifest)).toHaveLength(0);
  });

  it("keeps unexpected skips", () => {
    const report = {
      suites: [
        {
          file: "e2e/tests/brand.spec.ts",
          title: "",
          suites: [],
          specs: [
            {
              title: "brand detail renders",
              tests: [
                {
                  projectName: "deep",
                  status: "skipped",
                  results: [{ status: "skipped" }],
                  annotations: [],
                },
              ],
            },
          ],
        },
      ],
      stats: { skipped: 1 },
    };
    expect(unexpectedSkips(report, manifest)).toHaveLength(1);
  });

  it("never allows rate-limit patterns regardless of manifest", () => {
    const permissiveManifest: ExpectedSkipManifest = {
      version: 1,
      allowed: [{ title: "signup" }],
    };
    const report = {
      suites: [
        {
          file: "e2e/tests/auth.spec.ts",
          title: "",
          suites: [],
          specs: [
            {
              title: "signup flow",
              tests: [
                {
                  projectName: "deep",
                  status: "skipped",
                  results: [{ status: "skipped" }],
                  annotations: [
                    { type: "skip", description: "rate limit exceeded" },
                  ],
                },
              ],
            },
          ],
        },
      ],
      stats: { skipped: 1 },
    };
    const unexpected = unexpectedSkips(report, permissiveManifest);
    expect(unexpected).toHaveLength(1);
    expect(unexpected[0]!.reason).toContain("rate limit");
  });
});

/* --- existing incident tests migrated --- */

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
