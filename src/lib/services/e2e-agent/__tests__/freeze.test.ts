import { describe, expect, it } from "vitest";
import { freezeFailures, type RunResult } from "../freeze";

describe("freeze_extracts_failures_from_run_result", () => {
  it("produces FrozenFailure[] with file, title, error, fingerprint", () => {
    const runResult: RunResult = {
      failures: [
        {
          file: "e2e/tests/search.spec.ts",
          title: "search works",
          project: "deep",
          error: "Timed out waiting for selector",
        },
        {
          file: "e2e/tests/mobile.spec.ts",
          title: "mobile nav opens",
          project: "mobile",
        },
      ],
    };

    const set = freezeFailures(runResult);

    expect(set.failures).toHaveLength(2);

    const search = set.failures.find((f) => f.title === "search works");
    expect(search).toBeDefined();
    expect(search!.file).toBe("e2e/tests/search.spec.ts");
    expect(search!.title).toBe("search works");
    expect(search!.reason).toBe("Timed out waiting for selector");
    expect(search!.id).toMatch(/^[0-9a-f]{20}$/);

    const mobile = set.failures.find((f) => f.title === "mobile nav opens");
    expect(mobile).toBeDefined();
    expect(mobile!.file).toBe("e2e/tests/mobile.spec.ts");
    expect(mobile!.id).toMatch(/^[0-9a-f]{20}$/);
    expect(mobile!.id).not.toBe(search!.id);
  });

  it("includes failureSetHash", () => {
    const runResult: RunResult = {
      failures: [
        { file: "e2e/a.spec.ts", title: "test A", project: "deep" },
      ],
    };
    const set = freezeFailures(runResult);
    expect(set.failureSetHash).toBeTruthy();
    expect(typeof set.failureSetHash).toBe("string");
  });
});

describe("freeze_deduplicates_by_fingerprint", () => {
  it("removes duplicate failures silently", () => {
    const runResult: RunResult = {
      failures: [
        { file: "e2e/a.spec.ts", title: "test A", project: "deep" },
        { file: "e2e/a.spec.ts", title: "test A", project: "deep" },
        { file: "e2e/b.spec.ts", title: "test B", project: "deep" },
      ],
    };

    const set = freezeFailures(runResult);

    expect(set.failures).toHaveLength(2);
    const ids = set.failures.map(({ id }) => id);
    expect(new Set(ids).size).toBe(2);
  });

  it("keeps the first occurrence when duplicates have different errors", () => {
    const runResult: RunResult = {
      failures: [
        {
          file: "e2e/a.spec.ts",
          title: "test A",
          project: "deep",
          error: "first error",
        },
        {
          file: "e2e/a.spec.ts",
          title: "test A",
          project: "deep",
          error: "second error",
        },
      ],
    };

    const set = freezeFailures(runResult);
    expect(set.failures).toHaveLength(1);
    expect(set.failures[0].reason).toBe("first error");
  });
});
