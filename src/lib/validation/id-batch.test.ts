import { describe, expect, it } from "vitest";
import { isUuid, validateIdBatch } from "@/lib/validation/id-batch";

const OPTIONS = {
  max: 3,
  maxIdLength: 8,
  errorMessage: "Invalid selection",
};

describe("validateIdBatch", () => {
  it("dedupes while preserving first-seen order", () => {
    expect(validateIdBatch(["b", "a", "b"], OPTIONS)).toEqual({
      ok: true,
      ids: ["b", "a"],
    });
  });

  it("rejects a non-array selection", () => {
    expect(validateIdBatch("a", OPTIONS)).toEqual({
      ok: false,
      error: OPTIONS.errorMessage,
    });
  });

  it("rejects an empty selection", () => {
    expect(validateIdBatch([], OPTIONS)).toEqual({
      ok: false,
      error: OPTIONS.errorMessage,
    });
  });

  it("counts the cap against distinct ids, not raw length", () => {
    expect(validateIdBatch(["a", "a", "b", "c"], OPTIONS)).toEqual({
      ok: true,
      ids: ["a", "b", "c"],
    });
    expect(validateIdBatch(["a", "b", "c", "d"], OPTIONS)).toEqual({
      ok: false,
      error: OPTIONS.errorMessage,
    });
  });

  it("rejects a non-string, empty, or over-long id", () => {
    for (const bad of [[1], [""], ["x".repeat(9)]]) {
      expect(validateIdBatch(bad, OPTIONS)).toEqual({
        ok: false,
        error: OPTIONS.errorMessage,
      });
    }
  });

  it("returns the caller's message so per-queue wording is preserved", () => {
    expect(
      validateIdBatch([], { ...OPTIONS, errorMessage: "Invalid bulk evidence selection" }),
    ).toEqual({ ok: false, error: "Invalid bulk evidence selection" });
  });
});

describe("isUuid", () => {
  it("accepts a canonical uuid", () => {
    expect(isUuid("4f2a9d31-8b67-4c05-ae19-7d3f6b2c1a80")).toBe(true);
  });

  it("rejects a length-valid but non-uuid id", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("4f2a9d31-8b67-4c05-ae19-7d3f6b2c1a8")).toBe(false);
  });
});
