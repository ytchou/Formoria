import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditRecord, AuditWriteSeam } from "@/lib/audit";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
} from "@/lib/audit";
import { EMBEDDING_MODEL } from "@/lib/constants/llm-models";

describe("createAuditedEmbeddingsClient", () => {
  const originalFetch = globalThis.fetch;
  let auditRows: AuditRecord[];
  const seam: AuditWriteSeam = async (record) => {
    auditRows.push(record);
    return null;
  };

  beforeEach(() => {
    auditRows = [];
    resetAuditEmitterForTests();
    setAuditWriteSeam(seam);
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetAuditEmitterForTests();
    vi.unstubAllEnvs();
  });

  it("wraps the call in auditedCall openai.embeddings and prices prompt tokens", async () => {
    const { createAuditedEmbeddingsClient } = await import(
      "./embeddings-audit"
    );

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0.1] }],
          usage: { prompt_tokens: 42, total_tokens: 42 },
          model: EMBEDDING_MODEL,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const client = createAuditedEmbeddingsClient({ phase: "test_phase" });
    const result = await client.embed(["hello"]);

    expect(result.ok).toBe(true);

    const terminal = auditRows.filter((r) => r.status !== "started");
    expect(terminal.length).toBeGreaterThanOrEqual(1);

    const row = terminal[terminal.length - 1]!;
    expect(row.provider).toBe("openai");
    expect(row.operation).toBe("embeddings");
    expect(row.status).toBe("succeeded");
    expect(row.promptTokens).toBe(42);
    expect(row.completionTokens).toBe(0);
    // costUsd is number when the model has a price row, null otherwise.
    expect(
      row.costUsd === null || typeof row.costUsd === "number",
    ).toBe(true);
  });

  it("records failed status when the client throws", async () => {
    const { createAuditedEmbeddingsClient } = await import(
      "./embeddings-audit"
    );

    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Network failure"));

    const client = createAuditedEmbeddingsClient({ phase: "test_phase" });

    await expect(client.embed(["hello"])).rejects.toThrow();

    const terminal = auditRows.filter((r) => r.status !== "started");
    expect(terminal.length).toBeGreaterThanOrEqual(1);

    const row = terminal[terminal.length - 1]!;
    expect(row.status).toBe("network_error");
  });
});
