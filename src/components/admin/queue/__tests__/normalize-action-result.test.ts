import { describe, expect, it } from "vitest";

import { normalizeActionResult } from "../normalize-action-result";

describe("normalizeActionResult", () => {
  it("treats undefined as success", () => {
    const result = normalizeActionResult(undefined);

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("error");
  });

  it("maps error-only shape to failure", () => {
    expect(normalizeActionResult({ error: "Unable to approve" })).toMatchObject(
      {
        ok: false,
        error: "Unable to approve",
      },
    );
  });

  it("preserves warning alongside success", () => {
    const result = normalizeActionResult({ warning: "Cleanup is pending" });

    expect(result).toMatchObject({
      ok: true,
      warning: "Cleanup is pending",
    });
    expect(result).not.toHaveProperty("error");
  });

  it("classifies a non-empty failures array as a failure", () => {
    expect(
      normalizeActionResult({
        failures: [
          { submissionId: "submission-a", error: "Rejected" },
          { submissionId: "submission-b", error: "Stale" },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: "Rejected",
    });
  });

  it("falls back to a generic message when failures carry no error string", () => {
    // The two newer bulk services report `{ id, code }`, not `{ error }`.
    expect(
      normalizeActionResult({
        failures: [{ id: "item-a", code: "already_reviewed" }],
      }),
    ).toMatchObject({
      ok: false,
      error: "Action failed",
    });
  });

  it("surfaces the first failure message when several fail", () => {
    expect(
      normalizeActionResult({
        failures: [
          { id: "item-a", error: "First failure" },
          { id: "item-b", error: "Second failure" },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: "First failure",
    });
  });

  it("carries a warning flag on a PARTIAL failure", () => {
    // approveSubmissionsAction returns both at once; the consumer surfaces the
    // inline error AND fires the storage-cleanup toast.
    expect(
      normalizeActionResult({
        failures: [{ submissionId: "submission-a", error: "Stale" }],
        storageCleanupWarning: true,
      }),
    ).toMatchObject({
      ok: false,
      error: "Stale",
      warningKey: "storageCleanupWarning",
    });
  });

  it("carries a warning flag on an error-only failure", () => {
    expect(
      normalizeActionResult({
        error: "Unable to approve",
        storageCleanupWarning: true,
      }),
    ).toMatchObject({
      ok: false,
      error: "Unable to approve",
      warningKey: "storageCleanupWarning",
    });
  });

  it("maps a boolean warning flag to warningKey on success", () => {
    expect(
      normalizeActionResult({ storageCleanupWarning: true }),
    ).toMatchObject({
      ok: true,
      warningKey: "storageCleanupWarning",
    });
  });

  it("returns the raw payload so richer action contracts stay reachable", () => {
    const payload = { failures: [], deletedCount: 3 };

    expect(normalizeActionResult(payload).raw).toBe(payload);
  });
});
