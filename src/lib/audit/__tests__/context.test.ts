import { describe, expect, it } from "vitest";
import { getAuditContext } from "../context";
import { assertRegistered } from "../providers";

describe("audit context", () => {
  it("context returns null-ish default outside any scope", () => {
    expect(getAuditContext()).toEqual({ correlationId: null });
  });

  it("registry rejects an unregistered provider", () => {
    expect(() => assertRegistered("nope", "x")).toThrow();
  });
});
