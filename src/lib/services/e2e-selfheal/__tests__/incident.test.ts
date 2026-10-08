import { describe, expect, it } from "vitest";
import {
  collectSkipped,
  unexpectedSkips,
  type ExpectedSkipManifest,
} from "@/lib/services/e2e-report/gate";
import { freezeFailures } from "@/lib/services/e2e-selfheal/incident";

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
