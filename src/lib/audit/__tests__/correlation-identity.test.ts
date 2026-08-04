import { describe, expect, it } from "vitest";
import {
  getAuditContext,
  runWithAuditContext,
} from "../context";

describe("audit correlation identity", () => {
  it("returns the same correlation id for two nested calls in one scope", async () => {
    await runWithAuditContext({}, async () => {
      const first = getAuditContext();
      await Promise.resolve();
      const second = getAuditContext();

      expect(first.correlationId).toBe(second.correlationId);
    });
  });

  it("returns different correlation ids across two separate scopes", () => {
    const first = runWithAuditContext({}, () => getAuditContext());
    const second = runWithAuditContext({}, () => getAuditContext());

    expect(first.correlationId).not.toBe(second.correlationId);
  });

  it("returns a null-ish context outside any scope", () => {
    expect(getAuditContext()).toEqual({ correlationId: null });
  });
});
