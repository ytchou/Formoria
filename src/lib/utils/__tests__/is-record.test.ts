import { describe, expect, it } from "vitest";

import { isRecord } from "../is-record";

describe("isRecord", () => {
  it("accepts a plain object", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord({})).toBe(true);
  });

  it("accepts a null-prototype object", () => {
    expect(isRecord(Object.create(null))).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an array", [1, 2]],
    ["a string", "x"],
    ["a number", 1],
  ])("rejects %s", (_label, value) => {
    expect(isRecord(value)).toBe(false);
  });
});
