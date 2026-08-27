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

  /*
   * FORMORIA-61: the alert existed but could not be read. It passed the plain
   * `{code, message}` write error as `options.error`, and `captureAlert` routes
   * anything defined there to `Sentry.captureException` -- which groups a
   * non-`Error` under a stackless `<anonymous>` issue. And because the alert is
   * one shot per process, its context had to say how many records that one
   * event stands for.
   */
  describe("the write-loss alert", () => {
    const alertOptions = async (): Promise<{
      level?: string;
      context?: Record<string, unknown>;
      error?: unknown;
    }> => {
      setAuditWriteSeam(vi.fn(async () => ({ code: "08006", message: "database unavailable" })));
      await emitAuditRecord(record(), async () => {});

      // Without this the helper returns `{}` when the alert never fired, and
      // every assertion below reads an absent field -- the exception-routing
      // one is guarded by `!== undefined` and would pass vacuously.
      expect(captureAlert).toHaveBeenCalledTimes(1);

      const call = vi.mocked(captureAlert).mock.calls[0];
      return (call?.[1] ?? {}) as {
        level?: string;
        context?: Record<string, unknown>;
        error?: unknown;
      };
    };

    it("the loss alert carries the running loss count", async () => {
      const options = await alertOptions();

      expect(options.context).toMatchObject({
        code: "08006",
        message: "database unavailable",
        lossCount: auditWriteLossCount(),
      });
    });

    it("the loss alert is not captured as an exception from a plain object", async () => {
      const options = await alertOptions();

      // Either routing is acceptable; capturing a plain object is not.
      if (options.error !== undefined) {
        expect(options.error).toBeInstanceOf(Error);
      }
    });

    it("still fires exactly once per process", async () => {
      setAuditWriteSeam(vi.fn(async () => ({ message: "database unavailable" })));

      await emitAuditRecord(record(), async () => {});
      await emitAuditRecord(record(), async () => {});

      expect(auditWriteLossCount()).toBe(2);
      expect(captureAlert).toHaveBeenCalledTimes(1);
    });

    it("still reports level error", async () => {
      const options = await alertOptions();

      expect(options.level).toBe("error");
    });
  });

  it("the inline path spends one retry, not the full IN_PROCESS budget", async () => {
    const seam = vi.fn(async () => ({ message: "database unavailable" }));
    setAuditWriteSeam(seam);

    await emitAuditRecord(record(), async () => {});

    // Outside a Next request scope the write is on the caller's own path, so it
    // gets INLINE_POLICY (2 attempts) rather than IN_PROCESS (3).
    expect(seam).toHaveBeenCalledTimes(2);
    expect(auditWriteLossCount()).toBe(1);
  });

  it("a hung audit write is dropped at the inline budget instead of stalling the caller", async () => {
    setAuditWriteSeam(vi.fn(() => new Promise<null>(() => {})));
    vi.useFakeTimers();

    try {
      const emitted = emitAuditRecord(record(), async () => {});
      // Let the lazy `next/server` import settle so the budget timer exists.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2_000);
      await emitted;
    } finally {
      vi.useRealTimers();
    }

    // Counted once: the abandoned write is left to settle and must not be able
    // to report the same record a second time.
    expect(auditWriteLossCount()).toBe(1);
  });

  it("a unique violation on a retried insert is success, not a dropped record", async () => {
    setAuditWriteSeam(
      vi.fn(async () => ({ code: "23505", message: "duplicate key value violates unique constraint" })),
    );

    await emitAuditRecord(record(), async () => {});

    expect(auditWriteLossCount()).toBe(0);
    expect(captureAlert).not.toHaveBeenCalled();
  });

  it("audit record with token fields reaches the write path", async () => {
    const captured: AuditRecord[] = [];
    setAuditWriteSeam(vi.fn(async (written: AuditRecord) => {
      captured.push(written);
      return null;
    }));

    await emitAuditRecord(
      record({
        promptTokens: 200,
        completionTokens: 50,
        costUsd: 0.008,
      }),
      async () => {},
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]?.promptTokens).toBe(200);
    expect(captured[0]?.completionTokens).toBe(50);
    expect(captured[0]?.costUsd).toBe(0.008);
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
