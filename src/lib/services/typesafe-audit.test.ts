import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  runWithAuditContext,
  setAuditWriteSeam,
  type AuditCallContext,
  type AuditRecord,
} from "@/lib/audit";
import { JEV_MODEL } from "@/lib/constants/llm-models";
import { decide, type DecideDeps } from "./typesafe-audit";
import type { JevDecideResult, JevQuestion } from "./typesafe-client";

const state = { name: "Example", description: "A Taiwanese tea brand" };
const questions: Record<string, JevQuestion> = {
  isNonBrand: {
    type: "noul",
    instructions: "Is this entity something other than a consumer brand?",
  },
};

const clientResult: JevDecideResult = {
  model: JEV_MODEL,
  answers: { isNonBrand: { noul: 0.12 } },
  usage: { input_tokens: 120, output_tokens: 7 },
  latencyMs: 42,
};

function fakeClient(result: JevDecideResult = clientResult) {
  return { decide: vi.fn(async () => result) };
}

type Spec = Parameters<NonNullable<DecideDeps["audit"]>>[0];

/** An audit fn that records the spec and the ctx it handed out, then runs the call. */
function recordingAudit() {
  const calls: Array<{ spec: Spec; ctx: AuditCallContext }> = [];
  const audit: NonNullable<DecideDeps["audit"]> = async (spec, fn) => {
    const ctx: AuditCallContext = { summary: {} };
    calls.push({ spec, ctx });
    return fn(ctx);
  };
  return { audit, calls };
}

const pricedAt = (costUsd: number | null) =>
  vi.fn(async () => ({
    promptTokens: 120,
    cachedPromptTokens: 0,
    completionTokens: 7,
    costUsd,
  }));

describe("decide", () => {
  let auditRows: AuditRecord[];

  beforeEach(() => {
    auditRows = [];
    resetAuditEmitterForTests();
    setAuditWriteSeam(async (record) => {
      auditRows.push(record);
      return null;
    });
  });

  afterEach(() => {
    resetAuditEmitterForTests();
  });

  it("wraps the call in auditedCall with provider typesafe / operation decide", async () => {
    const { audit, calls } = recordingAudit();

    const result = await decide("detect", state, questions, {
      client: fakeClient(),
      audit,
      price: pricedAt(0.00000504),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.spec).toMatchObject({
      provider: "typesafe",
      operation: "decide",
      kind: "external",
    });
    expect(result.answers).toEqual(clientResult.answers);
    expect(result.usage).toEqual(clientResult.usage);
    expect(result.latencyMs).toBe(42);
  });

  it("maps usage to priceUsage and sets ctx.costUsd", async () => {
    const { audit, calls } = recordingAudit();
    const price = pricedAt(0.00000504);

    const result = await decide("detect", state, questions, {
      client: fakeClient(),
      audit,
      price,
    });

    expect(price).toHaveBeenCalledWith(JEV_MODEL, {
      prompt_tokens: 120,
      completion_tokens: 7,
    });
    expect(calls[0]!.ctx.costUsd).toBe(0.00000504);
    expect(result.costUsd).toBe(0.00000504);
  });

  it("leaves cost null and does not throw when the price lookup fails", async () => {
    const { audit, calls } = recordingAudit();
    const price = vi.fn(async () => {
      throw new Error("llm_model_prices unavailable");
    });

    const result = await decide("detect", state, questions, {
      client: fakeClient(),
      audit,
      price,
    });

    expect(result.costUsd).toBeNull();
    expect(calls[0]!.ctx.costUsd ?? null).toBeNull();
    expect(result.answers).toEqual(clientResult.answers);
  });

  it("emits one Langfuse generation when a trace is in the audit context", async () => {
    const generation = vi.fn();
    const { audit } = recordingAudit();

    await runWithAuditContext({ langfuseTrace: { generation } }, () =>
      decide("detect", state, questions, {
        client: fakeClient(),
        audit,
        price: pricedAt(0.00000504),
      }),
    );

    expect(generation).toHaveBeenCalledTimes(1);
    expect(generation.mock.calls[0]![0]).toMatchObject({
      name: "typesafe/decide",
      model: JEV_MODEL,
      input: { state, questions },
      output: clientResult.answers,
      costDetails: { total: 0.00000504 },
    });
  });

  it("truncates a large state in the Langfuse generation input", async () => {
    const generation = vi.fn();
    const { audit } = recordingAudit();
    const bigState = { text: "x".repeat(5_000) };

    await runWithAuditContext({ langfuseTrace: { generation } }, () =>
      decide("detect", bigState, questions, {
        client: fakeClient(),
        audit,
        price: pricedAt(null),
      }),
    );

    const input = generation.mock.calls[0]![0].input as {
      state: unknown;
      questions: unknown;
    };
    expect(typeof input.state).toBe("string");
    expect((input.state as string).length).toBeLessThan(2_100);
    expect(input.questions).toEqual(questions);
  });

  it("propagates client errors", async () => {
    const client = {
      decide: vi.fn(async (): Promise<JevDecideResult> => {
        throw new Error("TypeSafe request failed with status 422");
      }),
    };

    await expect(
      decide("detect", state, questions, { client, price: pricedAt(null) }),
    ).rejects.toThrow("status 422");

    const terminal = auditRows.filter((row) => row.status !== "started");
    expect(terminal).toHaveLength(1);
    expect(terminal[0]!.provider).toBe("typesafe");
    expect(terminal[0]!.operation).toBe("decide");
    expect(terminal[0]!.status).toBe("failed");
  });
});
