import { beforeEach, describe, expect, it } from "vitest";

/**
 * The row-based FAQ store (`brand_faq_entries`). The write policy is the whole
 * point of this table: `source = 'human'` copy must survive every enrichment
 * re-run, `source = 'model'` copy fills gaps by default, and only a job that
 * explicitly asked for the `faq` phase may overwrite a model answer.
 *
 * These run against an in-memory query-builder double rather than a mocked
 * `@/lib/supabase/service` — `scripts/check-test-boundaries.mjs` forbids the
 * latter, so the service takes an injectable client instead.
 */
import {
  getBrandFaqEntries,
  materializeSubmissionFaq,
  upsertBrandFaqEntries,
  type BrandFaqEntryInput,
  type FaqSupabase,
} from "../brand-faq";

const BRAND_ID = "6b2f1c4e-8d3a-4f21-9b57-0c9e1a7d4e88";

type EntryRow = {
  brand_id: string;
  preset_id: string;
  position: number;
  question_zh: string | null;
  answer_zh: string | null;
  question_en: string | null;
  answer_en: string | null;
  source: "model" | "human";
  updated_at: string;
};

function row(overrides: Partial<EntryRow> & { preset_id: string }): EntryRow {
  return {
    brand_id: BRAND_ID,
    position: 0,
    question_zh: null,
    answer_zh: null,
    question_en: null,
    answer_en: null,
    source: "model",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** What the service is allowed to send: `updated_at` is left to the trigger. */
type EntryUpsert = Omit<EntryRow, "updated_at">;

let table: EntryRow[] = [];
let selectCalls = 0;
let upsertCalls: Array<{
  onConflict: string | undefined;
  rows: EntryUpsert[];
}> = [];
let deleteCalls: Array<{
  eq: Array<[string, unknown]>;
  gte: Array<[string, number]>;
}> = [];

/** Configurable submission blob for the brand_submissions double. */
let submissionEnrichedData: Record<string, unknown> | null = null;
let submissionError: Error | null = null;

/**
 * Minimal Supabase double that actually stores rows, so the upsert's conflict
 * resolution is exercised rather than assumed.
 *
 * Also handles `brand_submissions` for `materializeSubmissionFaq` tests: the
 * `.select("enriched_data").eq("id", …).single()` path returns the configured
 * `submissionEnrichedData`.
 */
function createClientDouble() {
  return {
    from(tableName: string) {
      if (tableName === "brand_submissions") {
        const eqFilters: Array<[string, unknown]> = [];
        return {
          select(_columns: string) {
            return this;
          },
          eq(column: string, value: unknown) {
            eqFilters.push([column, value]);
            return this;
          },
          single() {
            if (submissionError) {
              return Promise.resolve({ data: null, error: submissionError });
            }
            if (submissionEnrichedData === null) {
              return Promise.resolve({
                data: null,
                error: { message: "Row not found", code: "PGRST116" },
              });
            }
            return Promise.resolve({
              data: { enriched_data: submissionEnrichedData },
              error: null,
            });
          },
        };
      }

      if (tableName !== "brand_faq_entries") {
        throw new Error(`unexpected table: ${tableName}`);
      }

      const eqFilters: Array<[string, unknown]> = [];
      const gteFilters: Array<[string, number]> = [];
      let deleting = false;
      const matches = (candidate: EntryRow) =>
        eqFilters.every(
          ([column, value]) => candidate[column as keyof EntryRow] === value,
        ) &&
        gteFilters.every(
          ([column, value]) =>
            (candidate[column as keyof EntryRow] as number) >= value,
        );

      const builder = {
        select() {
          selectCalls += 1;
          return builder;
        },
        eq(column: string, value: unknown) {
          eqFilters.push([column, value]);
          return builder;
        },
        gte(column: string, value: number) {
          gteFilters.push([column, value]);
          return builder;
        },
        delete() {
          deleting = true;
          return builder;
        },
        upsert(
          values: EntryUpsert[],
          options?: { onConflict?: string },
        ): Promise<{ error: null }> {
          upsertCalls.push({
            onConflict: options?.onConflict,
            rows: values.map((value) => ({ ...value })),
          });
          for (const value of values) {
            const index = table.findIndex(
              (candidate) =>
                candidate.brand_id === value.brand_id &&
                candidate.preset_id === value.preset_id &&
                candidate.position === value.position,
            );
            const merged = row({ ...(table[index] ?? {}), ...value });
            if (index >= 0) table[index] = merged;
            else table.push(merged);
          }
          return Promise.resolve({ error: null });
        },
        then(
          resolve: (result: {
            data: EntryRow[] | null;
            error: null;
          }) => unknown,
        ) {
          if (deleting) {
            deleteCalls.push({ eq: [...eqFilters], gte: [...gteFilters] });
            table = table.filter((candidate) => !matches(candidate));
            return Promise.resolve(resolve({ data: null, error: null }));
          }
          return Promise.resolve(
            resolve({ data: table.filter(matches), error: null }),
          );
        },
      };

      return builder;
    },
  };
}

function client() {
  return createClientDouble() as unknown as Parameters<
    typeof getBrandFaqEntries
  >[1];
}

function stored(presetId: string, position = 0): EntryRow | undefined {
  return table.find(
    (candidate) =>
      candidate.preset_id === presetId && candidate.position === position,
  );
}

function write(
  entries: BrandFaqEntryInput[],
  options: { explicitFaqPhase?: boolean } = {},
) {
  return upsertBrandFaqEntries(BRAND_ID, entries, {
    ...options,
    client: client(),
  });
}

const MODEL_PRODUCTS: BrandFaqEntryInput = {
  presetId: "main-products",
  questionZh: "這個品牌的主要產品有哪些？",
  answerZh: "以植鞣皮革製作的長夾與名片夾為主。",
  questionEn: "What are the main products?",
  answerEn: "Vegetable-tanned leather wallets and card holders.",
};

beforeEach(() => {
  table = [];
  selectCalls = 0;
  upsertCalls = [];
  deleteCalls = [];
  submissionEnrichedData = null;
  submissionError = null;
});

function customEntry(position: number, text: string): BrandFaqEntryInput {
  return {
    presetId: "custom",
    position,
    questionZh: `自訂問題 ${position}`,
    answerZh: text,
  };
}

describe("upsertBrandFaqEntries", () => {
  it("never persists a model-authored origin-story", async () => {
    await write([
      {
        presetId: "origin-story",
        questionZh: "品牌怎麼開始？",
        answerZh: "模型創立故事",
      },
    ]);

    expect(selectCalls).toBe(0);
    expect(upsertCalls).toHaveLength(0);
    expect(stored("origin-story")).toBeUndefined();
  });

  it("never overwrites a human-authored row", async () => {
    table.push(
      row({
        preset_id: "main-products",
        question_zh: "你們做什麼？",
        answer_zh: "小批量手縫皮件，全部在台南工作室完成。",
        source: "human",
      }),
    );

    await write([MODEL_PRODUCTS], { explicitFaqPhase: true });

    const entry = stored("main-products");
    expect(entry?.source).toBe("human");
    expect(entry?.answer_zh).toBe("小批量手縫皮件，全部在台南工作室完成。");
    // The human row is the only candidate, so nothing should reach the table.
    expect(upsertCalls).toHaveLength(0);
  });

  it("fills an empty model row", async () => {
    await write([MODEL_PRODUCTS]);

    const entry = stored("main-products");
    expect(entry?.source).toBe("model");
    expect(entry?.question_zh).toBe("這個品牌的主要產品有哪些？");
    expect(entry?.answer_en).toBe(
      "Vegetable-tanned leather wallets and card holders.",
    );
    expect(upsertCalls[0]?.onConflict).toBe("brand_id,preset_id,position");
  });

  it("leaves an existing model row alone by default", async () => {
    table.push(
      row({
        preset_id: "main-products",
        question_zh: "主要產品是什麼？",
        answer_zh: "手縫皮件。",
        question_en: "What do they make?",
        answer_en: "Hand-stitched leather goods.",
      }),
    );

    await write([MODEL_PRODUCTS]);

    expect(stored("main-products")?.answer_zh).toBe("手縫皮件。");
    expect(stored("main-products")?.answer_en).toBe(
      "Hand-stitched leather goods.",
    );
    expect(upsertCalls).toHaveLength(0);
  });

  it("overwrites a model row when the faq phase was explicitly requested", async () => {
    table.push(
      row({
        preset_id: "main-products",
        question_zh: "主要產品是什麼？",
        answer_zh: "手縫皮件。",
        question_en: "What do they make?",
        answer_en: "Hand-stitched leather goods.",
      }),
    );

    await write([MODEL_PRODUCTS], { explicitFaqPhase: true });

    expect(stored("main-products")?.answer_zh).toBe(
      "以植鞣皮革製作的長夾與名片夾為主。",
    );
    expect(stored("main-products")?.answer_en).toBe(
      "Vegetable-tanned leather wallets and card holders.",
    );
  });

  it("fills the en side of a zh-only model row", async () => {
    // The column-era bug: a zh-only entry counted as "filled" and blocked its
    // own English half from ever being written.
    table.push(
      row({
        preset_id: "main-products",
        question_zh: "主要產品是什麼？",
        answer_zh: "手縫皮件。",
      }),
    );

    await write([MODEL_PRODUCTS]);

    const entry = stored("main-products");
    expect(entry?.answer_en).toBe(
      "Vegetable-tanned leather wallets and card holders.",
    );
    // The already-answered zh side is a gap-fill target no longer, so it stays.
    expect(entry?.answer_zh).toBe("手縫皮件。");
  });

  it("reads existing rows with a single query", async () => {
    await write([
      MODEL_PRODUCTS,
      { presetId: "custom", position: 0, questionZh: "有維修服務嗎？", answerZh: "提供終身修補。" },
      { presetId: "custom", position: 1, questionZh: "可以客製嗎？", answerZh: "可指定顏色與燙印。" },
    ]);

    expect(selectCalls).toBe(1);
    expect(upsertCalls).toHaveLength(1);
    expect(table).toHaveLength(3);
  });
});

/**
 * Customs are the only preset that holds more than one row per brand, so they
 * are the only one that can be orphaned by a shorter re-authoring. Without a
 * cleanup the old rows keep rendering beside the new copy forever — nothing in
 * the module deleted anything.
 */
describe("upsertBrandFaqEntries — orphaned custom rows", () => {
  it("deletes model customs beyond the count just written", async () => {
    table.push(
      row({ preset_id: "custom", position: 0, question_zh: "一", answer_zh: "舊一" }),
      row({ preset_id: "custom", position: 1, question_zh: "二", answer_zh: "舊二" }),
      row({ preset_id: "custom", position: 2, question_zh: "三", answer_zh: "舊三" }),
      row({ preset_id: "custom", position: 3, question_zh: "四", answer_zh: "舊四" }),
    );

    await write([customEntry(0, "新一"), customEntry(1, "新二")], {
      explicitFaqPhase: true,
    });

    expect(
      table
        .filter((entry) => entry.preset_id === "custom")
        .map((entry) => entry.position)
        .sort(),
    ).toEqual([0, 1]);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.gte).toEqual([["position", 2]]);
  });

  it("never deletes a human custom row", async () => {
    table.push(
      row({ preset_id: "custom", position: 0, question_zh: "一", answer_zh: "舊一" }),
      row({
        preset_id: "custom",
        position: 2,
        question_zh: "店主自己寫的問題",
        answer_zh: "店主自己寫的回答",
        source: "human",
      }),
    );

    await write([customEntry(0, "新一")], { explicitFaqPhase: true });

    expect(stored("custom", 2)?.answer_zh).toBe("店主自己寫的回答");
    expect(deleteCalls[0]?.eq).toContainEqual(["source", "model"]);
  });

  it("deletes nothing when a fill-gaps run writes no custom row", async () => {
    table.push(
      row({ preset_id: "custom", position: 0, question_zh: "一", answer_zh: "舊一" }),
      row({ preset_id: "custom", position: 1, question_zh: "二", answer_zh: "舊二" }),
    );

    // Both candidates already have a renderable zh side, so a default
    // (non-explicit) run writes nothing — and must therefore delete nothing.
    await write([customEntry(0, "新一")]);

    expect(upsertCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
    expect(table.filter((entry) => entry.preset_id === "custom")).toHaveLength(2);
  });

  it("leaves non-custom presets untouched", async () => {
    table.push(
      row({ preset_id: "where-to-buy", position: 0, question_zh: "哪裡買？", answer_zh: "舊通路" }),
      row({ preset_id: "custom", position: 1, question_zh: "二", answer_zh: "舊二" }),
    );

    await write([customEntry(0, "新一")], { explicitFaqPhase: true });

    expect(stored("where-to-buy")?.answer_zh).toBe("舊通路");
    expect(table.filter((entry) => entry.preset_id === "custom")).toHaveLength(1);
  });
});

describe("getBrandFaqEntries", () => {
  it("returns camelCase entries ordered by preset then position", async () => {
    table.push(
      row({ preset_id: "custom", position: 1, question_zh: "二", answer_zh: "二。" }),
      row({ preset_id: "custom", position: 0, question_zh: "一", answer_zh: "一。" }),
      row({
        preset_id: "main-products",
        question_en: "What are the main products?",
        answer_en: "Leather goods.",
        source: "human",
      }),
    );

    const entries = await getBrandFaqEntries(BRAND_ID, client());

    expect(entries.map((entry) => [entry.presetId, entry.position])).toEqual([
      ["custom", 0],
      ["custom", 1],
      ["main-products", 0],
    ]);
    expect(entries[2]).toMatchObject({
      presetId: "main-products",
      questionEn: "What are the main products?",
      answerEn: "Leather goods.",
      source: "human",
    });
    expect(selectCalls).toBe(1);
  });
});

const SUBMISSION_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

describe("materializeSubmissionFaq", () => {
  it("materializes_entries_from_the_submission_blob", async () => {
    submissionEnrichedData = {
      faq: {
        entries: [
          {
            presetId: "main-products",
            position: 0,
            questionZh: "Q",
            answerZh: "A",
          },
        ],
        explicit: false,
      },
    };

    const result = await materializeSubmissionFaq(SUBMISSION_ID, BRAND_ID, {
      client: client(),
    });

    expect(result).toEqual({ entries: 1, explicit: false });
    expect(stored("main-products")).toBeDefined();
    expect(stored("main-products")?.source).toBe("model");
  });

  it("forwards_explicit_to_the_upsert", async () => {
    // Seed an existing model row.
    table.push(
      row({
        preset_id: "main-products",
        question_zh: "old Q",
        answer_zh: "old A",
      }),
    );

    submissionEnrichedData = {
      faq: {
        entries: [
          {
            presetId: "main-products",
            position: 0,
            questionZh: "new Q",
            answerZh: "new A",
          },
        ],
        explicit: true,
      },
    };

    const result = await materializeSubmissionFaq(SUBMISSION_ID, BRAND_ID, {
      client: client(),
    });

    expect(result).toEqual({ entries: 1, explicit: true });
    expect(stored("main-products")?.answer_zh).toBe("new A");
  });

  it("noop_when_blob_missing", async () => {
    // No faq key on enriched_data
    submissionEnrichedData = { description: "brand description" };
    const result = await materializeSubmissionFaq(SUBMISSION_ID, BRAND_ID, {
      client: client(),
    });
    expect(result).toBeNull();
    expect(upsertCalls).toHaveLength(0);

    // Submission row not found at all
    submissionEnrichedData = null;
    const result2 = await materializeSubmissionFaq(SUBMISSION_ID, BRAND_ID, {
      client: client(),
    });
    expect(result2).toBeNull();
    expect(upsertCalls).toHaveLength(0);
  });

  it("skips_malformed_blob", async () => {
    submissionEnrichedData = { faq: "not-valid" };
    const result = await materializeSubmissionFaq(SUBMISSION_ID, BRAND_ID, {
      client: client(),
    });
    expect(result).toBeNull();
    expect(upsertCalls).toHaveLength(0);
  });

  it("propagates_upsert_failure", async () => {
    submissionEnrichedData = {
      faq: {
        entries: [
          {
            presetId: "main-products",
            position: 0,
            questionZh: "Q",
            answerZh: "A",
          },
        ],
        explicit: false,
      },
    };

    // Create a failing client: reads succeed, but the upsert on
    // brand_faq_entries rejects.
    const failingClient = {
      from(tableName: string) {
        if (tableName === "brand_submissions") {
          return createClientDouble().from(tableName);
        }
        // brand_faq_entries: select succeeds (returns empty), upsert rejects
        const eqFilters: Array<[string, unknown]> = [];
        return {
          select() {
            return this;
          },
          eq(column: string, value: unknown) {
            eqFilters.push([column, value]);
            return this;
          },
          upsert(): Promise<{ error: { message: string } }> {
            return Promise.resolve({
              error: { message: "upsert failed" },
            });
          },
          then(
            resolve: (result: { data: EntryRow[] | null; error: null }) => unknown,
          ) {
            return Promise.resolve(resolve({ data: [], error: null }));
          },
        };
      },
    };

    await expect(
      materializeSubmissionFaq(SUBMISSION_ID, BRAND_ID, {
        client: failingClient as unknown as FaqSupabase,
      }),
    ).rejects.toMatchObject({ message: "upsert failed" });
  });
});
