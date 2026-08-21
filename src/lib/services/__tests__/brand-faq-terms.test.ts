import { beforeEach, describe, expect, it } from "vitest";
import { setAuditWriteSeam, type AuditRecord } from "@/lib/audit";
import {
  upsertBrandFaqEntries,
  type BrandFaqEntryInput,
  type FaqSupabase,
} from "../brand-faq";

/**
 * DEV-1546 write-path vocabulary REPORT for `brand_faq_entries`.
 *
 * The write path detects and never mutates. Chinese has no word delimiters, so
 * substring replacement rewrote correct Taiwan-Mandarin — 台南市保安路 became
 * 台南市保全路, 質量輕的材料 became 品質輕的材料 — and no shield or allowlist
 * can enumerate street names and proper nouns. These tests pin the payload that
 * actually reaches the Supabase client to be byte-identical to the input, and
 * pin the finding to the audit span instead.
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

/** Every hit recorded on the terminal audit row of the span just written. */
function recordedHits(): Array<Record<string, unknown>> {
  return auditRecords.flatMap((record) => {
    const fixes = record.summary?.bannedTerms;
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

describe("upsertBrandFaqEntries vocabulary report", () => {
  it("stores a banned term unchanged", async () => {
    const questionZh = `有${BANNED}介紹嗎？`;
    const answerZh = `官網上有一支${BANNED}。`;

    await write([{ presetId: "main-products", questionZh, answerZh }]);

    expect(upserts).toHaveLength(1);
    const row = upserts[0]?.[0] as Record<string, string>;
    expect(row.question_zh).toBe(questionZh);
    expect(row.answer_zh).toBe(answerZh);
    expect(JSON.stringify(row)).not.toContain(CORRECTED);
  });

  it("records the hit with its field and suggested replacement", async () => {
    await write([
      {
        presetId: "main-products",
        questionZh: `有${BANNED}介紹嗎？`,
        answerZh: `官網上有一支${BANNED}。`,
      },
    ]);

    expect(recordedHits()).toEqual(
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

  it("records nothing for clean text", async () => {
    const questionZh = `有${CORRECTED}介紹嗎？`;
    const answerZh = `官網上有一支${CORRECTED}。`;

    await write([{ presetId: "main-products", questionZh, answerZh }]);

    const row = upserts[0]?.[0] as Record<string, string>;
    expect(row.question_zh).toBe(questionZh);
    expect(row.answer_zh).toBe(answerZh);
    expect(recordedHits()).toEqual([]);
    expect(
      auditRecords.every(
        (record) => record.summary?.bannedTermCount === undefined,
      ),
    ).toBe(true);
  });

  /**
   * THE regression test for DEV-1546. Every string here is correct zh-TW that
   * merely contains a banned substring, and the mutating guard rewrote all of
   * them. A write must return each one untouched, byte for byte:
   *   - 保安 inside a Tainan street name
   *   - 質量 as the physics term (mass), which is valid zh-TW
   *   - 接口 straddling 直接 and 口頭
   *   - 全局 straddling 安全 and 局
   *   - 外賣 straddling 戶外 and 賣場
   *   - 當前 straddling 便當 and 前
   *
   * Every fixture must still CONTAIN a listed term, or the case is vacuous:
   * a string with nothing to rewrite passes even if the guard regresses to
   * mutating. That is what happened to the fixture 人潮密集成長, whose only
   * banned substring 集成 was pruned from the list in DEV-1547.
   */
  it.each([
    "台南市保安路",
    "質量輕的材料",
    "直接口頭說明",
    "公共安全局",
    "戶外賣場",
    "便當前的準備",
  ])("never rewrites the boundary false positive %s", async (text) => {
    await write([
      { presetId: "main-products", questionZh: text, answerZh: text },
    ]);

    const row = upserts[0]?.[0] as Record<string, string>;
    expect(row.question_zh).toBe(text);
    expect(row.answer_zh).toBe(text);
  });

  /**
   * The upsert carries the existing zh side forward whenever this write did not
   * author it. Reporting a hit on carried-forward text would attribute a stored
   * text finding to an unrelated English-side write, so the scan covers
   * authored zh only.
   */
  it("reports nothing on carried-forward zh when the write authors only English", async () => {
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
    expect(recordedHits()).toEqual([]);
    expect(
      auditRecords.every(
        (record) => record.summary?.bannedTermCount === undefined,
      ),
    ).toBe(true);
  });
});
