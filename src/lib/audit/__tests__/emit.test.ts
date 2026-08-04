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
