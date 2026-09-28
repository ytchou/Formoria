/**
 * Field labels of the chat user messages the Jev eval candidates parse back
 * into state (`src/lib/services/eval/jev-questions.ts`). They mirror the
 * templates in `category-classifier.ts` (detect), `name-arbiter.ts` (names) and
 * `scripts/distillation/export-training-data.ts` (product classify).
 */
export const JEV_INPUT_LABELS = {
  brandSlug: "品牌 slug",
  brandName: "品牌名稱",
  description: "描述",
  website: "網站",
  searchSnippets: "搜尋摘要",
  productName: "產品名稱",
  /** name-arbiter item line: the stored name, then the candidate list. */
  storedName: "儲存名稱",
  nameCandidates: "候選",
  /** One line per probed URL (`category-classifier.ts#probeLines`); may repeat. */
  probe: "探測",
  /** The value the templates write for a missing field. */
  missingValue: "無",
} as const;
