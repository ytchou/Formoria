import { DETECT_MESSAGE_LABELS } from "./detect-message";

/**
 * Field labels of the chat user messages the Jev eval candidates parse back
 * into state (`src/lib/services/eval/jev-questions.ts`). They mirror the
 * templates in `category-classifier.ts` (detect), `name-arbiter.ts` (names) and
 * `scripts/distillation/export-training-data.ts` (product classify).
 */
export const JEV_INPUT_LABELS = {
  brandSlug: DETECT_MESSAGE_LABELS.brandSlug,
  brandName: DETECT_MESSAGE_LABELS.brandName,
  description: DETECT_MESSAGE_LABELS.description,
  website: DETECT_MESSAGE_LABELS.website,
  /** Detect: the submitted `website_url`. */
  submittedWebsite: DETECT_MESSAGE_LABELS.submittedWebsite,
  /** Detect: one line per search result; may repeat. */
  searchResult: DETECT_MESSAGE_LABELS.searchResult,
  /** name-arbiter only: the joined SERP snippets line. */
  searchSnippets: "搜尋摘要",
  productName: "產品名稱",
  /** name-arbiter item line: the stored name, then the candidate list. */
  storedName: "儲存名稱",
  nameCandidates: "候選",
  /**
   * One line per probed URL (`category-classifier.ts#renderDetectUserMessage`);
   * may repeat.
   */
  probe: DETECT_MESSAGE_LABELS.probe,
  /** The value the templates write for a missing field. */
  missingValue: DETECT_MESSAGE_LABELS.missing,
} as const;
