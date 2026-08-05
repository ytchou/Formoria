import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditWriteLossCount,
  emitAuditRecord,
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { captureAlert } from "@/lib/adapters/alerting/sentry";

vi.mock("@/lib/adapters/alerting/sentry", () => ({
  captureAlert: vi.fn(() => true),
}));

const record = (overrides: Partial<AuditRecord> = {}): AuditRecord => ({
  spanId: randomUUID(),
  correlationId: randomUUID(),
  kind: "external",
  status: "started",
  provider: "openai",
  operation: "chat_completions",
  ...overrides,
});

beforeEach(() => {
  setAuditWriteSeam(vi.fn(async () => null));
});

afterEach(() => {
  resetAuditEmitterForTests();
  // `restoreAllMocks` only restores SPIES. The `captureAlert` mock is created by
  // a `vi.mock` factory, so its call history survives -- and the alert fired by
  // the write-loss test above then read as an alert fired by the next test.
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("emitAuditRecord", () => {
  it("sustained write loss fires exactly one Sentry alert per process", async () => {
    setAuditWriteSeam(vi.fn(async () => ({ message: "database unavailable" })));

    await emitAuditRecord(record(), async () => {});
    await emitAuditRecord(record(), async () => {});

    expect(auditWriteLossCount()).toBe(2);
    expect(captureAlert).toHaveBeenCalledTimes(1);
  });

  it("a unique violation on a retried insert is success, not a dropped record", async () => {
    setAuditWriteSeam(
      vi.fn(async () => ({ code: "23505", message: "duplicate key value violates unique constraint" })),
    );

    await emitAuditRecord(record(), async () => {});

    expect(auditWriteLossCount()).toBe(0);
    expect(captureAlert).not.toHaveBeenCalled();
  });

  it("the emitted summary is detached from the caller's object", async () => {
    const captured: AuditRecord[] = [];
    setAuditWriteSeam(vi.fn(async (written: AuditRecord) => {
      captured.push(written);
      return null;
    }));

    const summary = { result: { recordCount: 0 } };
    await emitAuditRecord(record({ summary }), async () => {});
    summary.result.recordCount = 42;

    expect(captured[0]?.summary).toEqual({ result: { recordCount: 0 } });
  });

  it("stdout payload is valid JSON and retains the ENRICH token when present", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await emitAuditRecord(
      record({
        logTag: "[ENRICH]",
        summary: { token: "secret-value" },
      }),
      async () => {},
    );

    const payload = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload.event).toBe("audit");
    expect(payload.logTag).toBe("[ENRICH]");
    expect(payload.summary).toEqual({ token: "[redacted]" });
  });
});
