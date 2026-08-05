import type { SupabaseClient } from "@supabase/supabase-js";
import type { Brand } from "@/lib/types";
import { createServiceClient } from "@/lib/supabase/server";
import { FAQ_PRESETS, type FaqBrandContext } from "@/lib/brands/faq-presets";
import type { FaqQuestion } from "@/lib/json-ld";
import type { Database } from "@/lib/supabase/database.types";

export type TFn = (key: string, params?: Record<string, unknown>) => string;

export type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

const PRESET_QUESTION_KEYS: Record<string, string> = {
  "taiwan-origin": "brandFaq.isMadeInTaiwan.question",
  "main-products": "brandFaq.mainProducts.question",
  "price-positioning": "brandFaq.priceRange.question",
  reputation: "brandFaq.reputation.question",
};

export function faqItemsToQuestions(items: FaqItem[]): FaqQuestion[] {
  return items.map((item) => ({ q: item.question, a: item.answer }));
}

export async function getBrandFaq(
  brandId: string,
  brand: Brand,
  t: TFn,
  locale: string = "zh-TW",
  cityLabel: string | null = null,
  client?: FaqSupabase,
): Promise<FaqItem[]> {
  const rows = await getBrandFaqEntries(brandId, client);
  const isZh = !locale.startsWith("en");
  const ctx: FaqBrandContext = { brand, cityLabel, peerStats: null };
  const rowsByPreset = new Map<string, BrandFaqEntryRow[]>();

  for (const row of rows) {
    const question = isZh ? row.questionZh : row.questionEn;
    const answer = isZh ? row.answerZh : row.answerEn;
    if (!sideRenders(question, answer)) continue;
    const presetRows = rowsByPreset.get(row.presetId) ?? [];
    presetRows.push(row);
    rowsByPreset.set(row.presetId, presetRows);
  }

  const items: FaqItem[] = [];
  for (const preset of FAQ_PRESETS) {
    const stored = rowsByPreset.get(preset.id) ?? [];
    if (stored.length > 0) {
      const ordered = [...stored].sort(
        (a, b) =>
          (a.source === "human" ? 0 : 1) - (b.source === "human" ? 0 : 1) ||
          a.position - b.position,
      );
      const selected = preset.id === "custom"
        ? [...stored].sort((a, b) => a.position - b.position)
        : [ordered[0]];
      for (const row of selected) {
        const question = isZh ? row.questionZh : row.questionEn;
        const answer = isZh ? row.answerZh : row.answerEn;
        if (question == null || answer == null) continue;
        items.push({
          id: preset.id === "custom" ? `custom-${row.position}` : preset.id,
          question,
          answer,
        });
      }
      continue;
    }

    // Eligibility gates only the template floor, not stored rows. The request
    // path has no peer stats, so gating stored category/price answers would
    // silently hide model-authored answers.
    const questionKey = PRESET_QUESTION_KEYS[preset.id];
    if (!preset.eligible(ctx) || preset.templateFloor === null || !questionKey) continue;
    items.push({
      id: preset.id,
      question: t(questionKey, { brandName: brand.name }),
      answer: preset.templateFloor(ctx, t, locale),
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// brand_faq_entries — row-based FAQ storage
// ---------------------------------------------------------------------------

/** The table is reached through the untyped `from` surface, with generated DB shapes at the boundary. */
export type FaqSupabase = Pick<SupabaseClient, "from">;

export type BrandFaqEntrySource = "model" | "human";

/** A stored row, transformed to camelCase at this service boundary. */
export type BrandFaqEntryRow = {
  presetId: string;
  position: number;
  questionZh: string | null;
  answerZh: string | null;
  questionEn: string | null;
  answerEn: string | null;
  source: BrandFaqEntrySource;
};

/**
 * A model-authored candidate. `source` is deliberately absent: every write
 * through this function is an enrichment write. Human copy is authored
 * elsewhere and is only ever *protected* here, never produced.
 */
export type BrandFaqEntryInput = {
  presetId: string;
  position?: number;
  questionZh?: string | null;
  answerZh?: string | null;
  questionEn?: string | null;
  answerEn?: string | null;
};

type FaqEntryTable = Database["public"]["Tables"]["brand_faq_entries"];
type FaqEntryReadRow = Pick<
  FaqEntryTable["Row"],
  "preset_id" | "question_zh" | "answer_zh" | "question_en" | "answer_en"
> & { position: number | null; source: BrandFaqEntrySource };
/** `brand_id` is attached at the upsert call site, so the row payload omits it. */
type FaqEntryInsert = Omit<FaqEntryTable["Insert"], "brand_id">;

function faqClient(client?: FaqSupabase): FaqSupabase {
  return client ?? (createServiceClient() as unknown as FaqSupabase);
}

function entryKey(presetId: string, position: number): string {
  return `${presetId}\u0000${position}`;
}

function toEntry(row: FaqEntryReadRow): BrandFaqEntryRow {
  return {
    presetId: row.preset_id,
    position: row.position ?? 0,
    questionZh: row.question_zh ?? null,
    answerZh: row.answer_zh ?? null,
    questionEn: row.question_en ?? null,
    answerEn: row.answer_en ?? null,
    source: row.source,
  };
}

/**
 * Every stored entry for one brand, in catalog-resolution order (preset, then
 * position). One query — the composite primary key already leads with
 * `brand_id`, so there is nothing to add per preset.
 */
export async function getBrandFaqEntries(
  brandId: string,
  client?: FaqSupabase,
): Promise<BrandFaqEntryRow[]> {
  const { data, error } = await faqClient(client)
    .from("brand_faq_entries")
    .select(
      "preset_id, position, question_zh, answer_zh, question_en, answer_en, source",
    )
    .eq("brand_id", brandId);
  if (error) throw error;

  return ((data ?? []) as FaqEntryReadRow[])
    .map(toEntry)
    .sort(
      (a, b) =>
        a.presetId.localeCompare(b.presetId) || a.position - b.position,
    );
}

/** A locale side renders only when both its question and its answer exist. */
function sideRenders(
  question: string | null | undefined,
  answer: string | null | undefined,
): boolean {
  return hasValue(question) && hasValue(answer);
}

function normalize(value: string | null | undefined): string | null {
  return hasValue(value) ? value.trim() : null;
}

/**
 * Writes model-authored FAQ entries, one row per `(preset_id, position)`.
 *
 * The policy, in precedence order:
 *
 *   1. `source = 'human'` rows are never touched, under any option. A brand
 *      owner's or an admin's own words must survive every re-run of the model,
 *      and this runs on every refresh apply. That is a real provenance check
 *      now, replacing the "column looks filled" heuristic the column-era code
 *      used — which could not tell human copy from model copy at all.
 *   2. `source = 'model'` rows fill gaps only, per locale side. A zh-only row
 *      no longer blocks its own English half forever: each side is judged on
 *      whether *it* renders, not on whether the entry as a whole looks filled.
 *   3. A job that explicitly requested the `faq` phase may overwrite model
 *      rows. Re-authoring existing FAQ copy is then a deliberate act with a
 *      job behind it, never a side effect of an unrelated refresh.
 */
export async function upsertBrandFaqEntries(
  brandId: string,
  entries: BrandFaqEntryInput[],
  options: { explicitFaqPhase?: boolean; client?: FaqSupabase } = {},
): Promise<void> {
  const candidates = (entries ?? [])
    .map((entry) => ({
      presetId: entry.presetId,
      position: entry.position ?? 0,
      questionZh: normalize(entry.questionZh),
      answerZh: normalize(entry.answerZh),
      questionEn: normalize(entry.questionEn),
      answerEn: normalize(entry.answerEn),
    }))
    // An entry with no renderable side has nothing to contribute and would
    // only create an empty row that then blocks nothing and shows nothing.
    .filter(
      (entry) =>
        hasValue(entry.presetId) &&
        (sideRenders(entry.questionZh, entry.answerZh) ||
          sideRenders(entry.questionEn, entry.answerEn)),
    );
  // Nothing usable in the payload — return before touching the database at
  // all, so an un-enriched brand costs zero queries on every apply.
  if (candidates.length === 0) return;

  const supabase = faqClient(options.client);
  const existing = await getBrandFaqEntries(brandId, supabase);
  const existingByKey = new Map(
    existing.map((entry) => [entryKey(entry.presetId, entry.position), entry]),
  );

  const payload: FaqEntryInsert[] = [];
  for (const candidate of candidates) {
    const current = existingByKey.get(
      entryKey(candidate.presetId, candidate.position),
    );
    if (current?.source === "human") continue;

    const overwrite = options.explicitFaqPhase === true;
    const takeZh =
      sideRenders(candidate.questionZh, candidate.answerZh) &&
      (overwrite || !sideRenders(current?.questionZh, current?.answerZh));
    const takeEn =
      sideRenders(candidate.questionEn, candidate.answerEn) &&
      (overwrite || !sideRenders(current?.questionEn, current?.answerEn));
    if (!takeZh && !takeEn) continue;

    payload.push({
      preset_id: candidate.presetId,
      position: candidate.position,
      question_zh: takeZh ? candidate.questionZh : (current?.questionZh ?? null),
      answer_zh: takeZh ? candidate.answerZh : (current?.answerZh ?? null),
      question_en: takeEn ? candidate.questionEn : (current?.questionEn ?? null),
      answer_en: takeEn ? candidate.answerEn : (current?.answerEn ?? null),
      source: "model",
    });
  }
  if (payload.length === 0) return;

  // `upsert` rather than branching on `current`: it inserts when the row is
  // absent and updates the listed columns when it is not, which also closes
  // the read-then-write race between two concurrent applies.
  const { error } = await supabase.from("brand_faq_entries").upsert(
    payload.map((row) => ({ brand_id: brandId, ...row })),
    { onConflict: "brand_id,preset_id,position" },
  );
  if (error) throw error;
}

function hasValue(value: string | null | undefined): value is string {
  return value != null && value.trim() !== "";
}
