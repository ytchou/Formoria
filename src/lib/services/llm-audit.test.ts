import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
  type AuditRecord,
} from "@/lib/audit";
import { createAuditedOpenAIClient } from "./llm-audit";
import { brandTarget } from "./_shared/enrichment-target";

type InsertedRow = Record<string, unknown>;

function fakeSupabase(inserts: InsertedRow[]) {
  return {
    from(table: string) {
      if (table !== "brand_ai_results") {
        throw new Error(`Unexpected table ${table}`);
      }

      return {
        insert: async (row: InsertedRow) => {
          inserts.push(row);
          return { error: null };
        },
      };
    },
  } as never;
}

const target = brandTarget("00000000-0000-4000-8000-000000000001");

let writes: AuditRecord[];

beforeEach(() => {
  writes = [];
  setAuditWriteSeam(async (record) => {
    writes.push(record);
    return null;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "answer" } }] }),
        { status: 200 },
      ),
    ),
  );
});

afterEach(() => {
  resetAuditEmitterForTests();
  vi.unstubAllGlobals();
});

describe("audited LLM clients", () => {
  it("an audited LLM call writes a span linked to its brand_ai_results row", async () => {
    const inserts: InsertedRow[] = [];
    const client = createAuditedOpenAIClient(
      {
        target,
        phase: "descriptions",
        supabase: fakeSupabase(inserts),
      },
      { apiKey: "k" },
    );

    await client.chat({ system: "s", user: "u" });

    expect(writes).toHaveLength(2);
    expect(writes[0]?.status).toBe("started");
    expect(writes[1]?.status).toBe("succeeded");
    expect(writes[0]?.spanId).toBe(writes[1]?.spanId);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.audit_span_id).toBe(writes[0]?.spanId);
    expect(inserts[0]).toMatchObject({
      brand_id: target.id,
      raw_response: {
        provider: "openai",
        ok: true,
        status: 200,
      },
    });
    expect(inserts[0]?.prompt_tokens).toBeNull();
  });
});
