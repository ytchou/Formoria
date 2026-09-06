/**
 * How many brands one curated-product backfill run may carry (DEV-1469).
 *
 * It lives here, not beside the server action that enforces it, for one reason:
 * the admin brand list has to be able to STOP the admin at the limit rather
 * than let them build a 101-brand selection and receive an error. A `'use
 * server'` module can only export async functions, so the action cannot hand
 * the number to the component.
 *
 * The value is pinned to `drop_needs_data_submissions`' own cap of 100, because
 * that RPC is the backfill's rollback path: a run this action can open must be
 * a run it can also roll back in one call.
 */
export const MAX_BULK_PRODUCT_BACKFILL = 100;

// ---------------------------------------------------------------------------
// Editorial bands (DEV-1695)
// ---------------------------------------------------------------------------

/**
 * Anchored editorial bands for product ranking calibration.
 *
 * These are the English-only code constants. The golden Chinese anchor lives in
 * `lib/prompts/products.ts` and is NOT modified here.
 */
export const EDITORIAL_BANDS = [
  {
    key: "ineligible" as const,
    min: 0,
    max: 39,
    label:
      "weak or ineligible: little editorial value, or not a single-product page, a duplicate style/variant, missing a usable official product URL or source, or insufficient evidence to identify and classify the product.",
  },
  {
    key: "generic" as const,
    min: 40,
    max: 59,
    label:
      "generic: an eligible product with durable facts, but the evidence shows a common item with little product-specific design, material, technique, function, or brand expression.",
  },
  {
    key: "representative" as const,
    min: 60,
    max: 74,
    label:
      "representative: clearly expresses a core brand product line and has concrete product-specific evidence, but is not among the pool's most distinctive examples.",
  },
  {
    key: "strong" as const,
    min: 75,
    max: 89,
    label:
      "strong: combines clear brand relevance with a distinctive, well-evidenced design decision, material use, technique, function, or cultural idea.",
  },
  {
    key: "exceptional" as const,
    min: 90,
    max: 100,
    label:
      "exceptional: a rare flagship-level product whose distinctive concept and execution are unusually clear in the supplied durable evidence. Reserve this band; polish alone is never exceptional.",
  },
] as const;

export type EditorialBand = (typeof EDITORIAL_BANDS)[number]["key"];

/**
 * Returns the editorial band key for a 0-100 integer score.
 * Returns `null` for `null`, `NaN`, negative, `> 100`, or non-integer scores.
 */
export function bandOf(score: number | null): EditorialBand | null {
  if (score === null || !Number.isInteger(score) || score < 0 || score > 100) {
    return null;
  }
  for (const band of EDITORIAL_BANDS) {
    if (score >= band.min && score <= band.max) return band.key;
  }
  // Unreachable for 0-100 integers, but satisfies the compiler.
  return null;
}

/**
 * Score-based cutoff window width. A candidate is kept when its LLM score is
 * within `bestScore - CUTOFF_WINDOW` (inclusive).
 */
export const CUTOFF_WINDOW = 15;

/**
 * Renders editorial bands as ASCII-only lines for prompt injection.
 *
 * Example output line: `- 0-39 — weak or ineligible: ...`
 */
export function renderEditorialBands(): string {
  return EDITORIAL_BANDS.map(
    (b) => `- ${b.min}-${b.max} — ${b.label}`,
  ).join("\n");
}
