import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  auditedCall,
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
  type AuditWriteSeam,
} from "@/lib/audit";

vi.mock("@/lib/adapters/alerting/sentry", () => ({
  captureAlert: vi.fn(() => true),
}));

const spec = () => ({
  provider: "openai",
  operation: "chat_completions",
  kind: "external" as const,
});

let writes: AuditRecord[];
let seam: Mock<AuditWriteSeam>;

beforeEach(() => {
  writes = [];
  seam = vi.fn(async (record: AuditRecord) => {
    writes.push(record);
    return null;
  });
  setAuditWriteSeam(seam);
});

afterEach(() => {
  resetAuditEmitterForTests();
});

describe("auditedCall", () => {
  it("writes a start row then a finish row sharing one span_id", async () => {
    await auditedCall(spec(), async () => "done", { wait: async () => {} });

    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({ status: "started" });
    expect(writes[1]).toMatchObject({ status: "succeeded" });
    expect(writes[0]?.spanId).toBe(writes[1]?.spanId);
  });

  it("finish row carries latency_ms", async () => {
    await auditedCall(spec(), async () => "done", { wait: async () => {} });

    expect(writes[0]?.latencyMs).toBeUndefined();
    expect(writes[1]?.latencyMs).toEqual(expect.any(Number));
    expect(writes[1]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns the wrapped result untouched", async () => {
    const result = { value: "kept" };

    await expect(
      auditedCall(spec(), () => result, { wait: async () => {} }),
    ).resolves.toBe(result);

    const error = new Error("original");
    await expect(
      auditedCall(spec(), () => Promise.reject(error), { wait: async () => {} }),
    ).rejects.toBe(error);
  });

  it("a thrown error produces a failed finish row and rethrows", async () => {
    const error = new Error("operation failed");

    await expect(
      auditedCall(spec(), () => {
        throw error;
      }, { wait: async () => {} }),
    ).rejects.toBe(error);
    expect(writes.some((record) => record.status === "failed")).toBe(true);
  });

  it("audit write failure never fails the operation", async () => {
    seam.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      auditedCall(spec(), async () => "still works", { wait: async () => {} }),
    ).resolves.toBe("still works");
  });

  it("fields attached through ctx.summary reach the finish row only", async () => {
    await auditedCall(
      spec(),
      async (ctx) => {
        ctx.summary.contentType = "text/html";
        ctx.summary.byteLength = 1024;
        return "done";
      },
      { summary: { url: "https://example.com" }, wait: async () => {} },
    );

    expect(writes[0]?.summary).toEqual({ url: "https://example.com" });
    expect(writes[1]?.summary).toEqual({
      url: "https://example.com",
      contentType: "text/html",
      byteLength: 1024,
    });
  });

  it("ctx.summary reaches the finish row when fn throws", async () => {
    await expect(
      auditedCall(
        spec(),
        async (ctx) => {
          ctx.summary.status = 500;
          throw new Error("boom");
        },
        { wait: async () => {} },
      ),
    ).rejects.toThrow("boom");

    expect(writes[1]?.summary).toEqual({ status: 500 });
  });

  it("the started row is unaffected by a summary the caller mutates during fn", async () => {
    const summary = { result: { recordCount: 0 } };

    await auditedCall(
      spec(),
      async () => {
        summary.result.recordCount = 42;
        return "done";
      },
      { summary, wait: async () => {} },
    );

    expect(writes[0]?.summary).toEqual({ result: { recordCount: 0 } });
  });

  it("span_id is generated before the first write", async () => {
    let firstSpanId: string | undefined;
    seam.mockImplementation(async (record: AuditRecord) => {
      firstSpanId = record.spanId;
      return null;
    });

    await auditedCall(spec(), async () => "done", {
      wait: async () => {},
    });

    expect(firstSpanId).toEqual(expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    ));
  });
});
