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

  it("a nested scope inherits the outer correlation id", () => {
    const { outer, inner } = runWithAuditContext({}, () => {
      const outerId = getAuditContext().correlationId;
      const innerId = runWithAuditContext({}, () => getAuditContext().correlationId);
      return { outer: outerId, inner: innerId };
    });

    expect(outer).toEqual(expect.any(String));
    expect(inner).toBe(outer);
  });

  it("an explicit seed correlation id still wins over the ambient one", () => {
    const inner = runWithAuditContext({}, () =>
      runWithAuditContext({ correlationId: "seeded" }, () => getAuditContext().correlationId),
    );

    expect(inner).toBe("seeded");
  });

  it("two sibling scopes still get different correlation ids", () => {
    const first = runWithAuditContext({}, () => getAuditContext().correlationId);
    const second = runWithAuditContext({}, () => getAuditContext().correlationId);

    expect(first).toEqual(expect.any(String));
    expect(second).not.toBe(first);
  });

  it("returns a null-ish context outside any scope", () => {
    expect(getAuditContext()).toEqual({ correlationId: null });
  });
});
