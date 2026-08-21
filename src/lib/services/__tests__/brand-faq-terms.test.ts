import { beforeEach, describe, expect, it } from "vitest";
import { setAuditWriteSeam, type AuditRecord } from "@/lib/audit";
import {
  upsertBrandFaqEntries,
  type BrandFaqEntryInput,
  type FaqSupabase,
} from "../brand-faq";

/**
 * DEV-1543 write-path vocabulary gate for `brand_faq_entries`.
 *
 * This table is the only text that feeds `FAQPage` JSON-LD, and it is re-authored
 * on every enrichment apply — so a backfill alone cannot hold the line. These
 * tests pin the guard to the payload that actually reaches the Supabase client,
 * not to a helper's return value.
 *
 * The client is INJECTED, never mocked: `scripts/check-test-boundaries.mjs`
 * forbids `vi.mock` of `@/lib/supabase/`, and the service already accepts
 * `options.client` for exactly this reason.
 */

const BRAND_ID = "6b2f1c4e-8d3a-4f21-9b57-0c9e1a7d4e88";

const BANNED = "視頻";
const CORRECTED = "影片";

type UpsertRow = Record<string, unknown>;

let upserts: UpsertRow[][] = [];
let auditRecords: AuditRecord[] = [];

/**
 * Records what is written and reports an empty table on read, so every write is
 * a first write and the guard is exercised on a full payload.
 */
function clientDouble(existing: UpsertRow[] = []): FaqSupabase {
  const double = {
    from(table: string) {
      if (table !== "brand_faq_entries") {
        throw new Error(`unexpected table: ${table}`);
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        delete: () => builder,
        upsert(rows: UpsertRow[]) {
          upserts.push(rows);
          return Promise.resolve({ error: null });
        },
        then(resolve: (result: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve(resolve({ data: existing, error: null }));
        },
      };
      return builder;
    },
  };
  return double as unknown as FaqSupabase;
}

function write(entries: BrandFaqEntryInput[], existing: UpsertRow[] = []) {
  return upsertBrandFaqEntries(BRAND_ID, entries, {
    client: clientDouble(existing),
  });
}

/** Every fix recorded on the terminal audit row of the span just written. */
function recordedFixes(): Array<Record<string, unknown>> {
  return auditRecords.flatMap((record) => {
    const fixes = record.summary?.bannedTermFixes;
    return Array.isArray(fixes)
      ? (fixes as Array<Record<string, unknown>>)
      : [];
  });
}

beforeEach(() => {
  upserts = [];
  auditRecords = [];
  setAuditWriteSeam(async (record) => {
    auditRecords.push(record);
    return null;
  });
});

// `src/test/setup.ts` resets the emitter after every test, so no teardown here.

describe("upsertBrandFaqEntries vocabulary guard", () => {
  it("corrects a banned term before writing", async () => {
    await write([
      {
        presetId: "main-products",
        questionZh: `有${BANNED}介紹嗎？`,
        answerZh: `官網上有一支${BANNED}。`,
      },
    ]);

    expect(upserts).toHaveLength(1);
    const row = upserts[0]?.[0] as Record<string, string>;
    expect(row.question_zh).toBe(`有${CORRECTED}介紹嗎？`);
    expect(row.answer_zh).toBe(`官網上有一支${CORRECTED}。`);
    expect(JSON.stringify(row)).not.toContain(BANNED);
  });

  it("records the substitution", async () => {
    await write([
      {
        presetId: "main-products",
        questionZh: `有${BANNED}介紹嗎？`,
        answerZh: `官網上有一支${BANNED}。`,
      },
    ]);

    const fixes = recordedFixes();
    expect(fixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "question_zh",
          term: BANNED,
          replacement: CORRECTED,
        }),
        expect.objectContaining({
          field: "answer_zh",
          term: BANNED,
          replacement: CORRECTED,
        }),
      ]),
    );
  });

  it("leaves clean text untouched", async () => {
    const questionZh = `有${CORRECTED}介紹嗎？`;
    const answerZh = `官網上有一支${CORRECTED}。`;

    await write([{ presetId: "main-products", questionZh, answerZh }]);

    const row = upserts[0]?.[0] as Record<string, string>;
    expect(row.question_zh).toBe(questionZh);
    expect(row.answer_zh).toBe(answerZh);
    expect(recordedFixes()).toEqual([]);
    expect(
      auditRecords.every(
        (record) => record.summary?.bannedTermFixCount === undefined,
      ),
    ).toBe(true);
  });

  /**
   * The upsert carries the existing zh side forward whenever this write did not
   * author it, so guarding the whole payload made an English-only refresh
   * rewrite stored zh text — a mutation the caller never requested, recorded
   * against an English-side write. The guard covers authored zh only.
   */
  it("leaves stored zh untouched when the write authors only English", async () => {
    const storedQuestion = `有${BANNED}介紹嗎？`;
    const storedAnswer = `官網上有一支${BANNED}。`;

    await write(
      [
        {
          presetId: "main-products",
          questionEn: "Is there a product video?",
          answerEn: "Yes, on the official site.",
        },
      ],
      [
        {
          preset_id: "main-products",
          position: 0,
          question_zh: storedQuestion,
          answer_zh: storedAnswer,
          question_en: null,
          answer_en: null,
          source: "model",
        },
      ],
    );

    expect(upserts).toHaveLength(1);
    const row = upserts[0]?.[0] as Record<string, string>;
    expect(row.question_zh).toBe(storedQuestion);
    expect(row.answer_zh).toBe(storedAnswer);
    expect(row.question_en).toBe("Is there a product video?");
    expect(recordedFixes()).toEqual([]);
    expect(
      auditRecords.every(
        (record) => record.summary?.bannedTermFixCount === undefined,
      ),
    ).toBe(true);
  });
});
