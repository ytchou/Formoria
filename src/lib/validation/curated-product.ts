import { z } from "zod";

import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";

/**
 * Payload shapes for the curated-product admin write path (DEV-1465).
 *
 * Conventions mirror `admin-review.ts`: zod-v4 top-level style (`z.uuid()`),
 * explicit bounds whose source is named in a comment, `.safeParse` at the call
 * site, and a generic `{ error: "Invalid …" }` from the action rather than a
 * leaked zod issue list.
 */

/**
 * The L1 CHECK list of `curated_products`
 * (supabase/migrations/20260813120000_curated_products.sql), which is itself the
 * same 12 values as `brands.product_type`. Derived from the ontology rather than
 * re-typed so a taxonomy change cannot leave two copies disagreeing; the length
 * assertion in the test is what pins it to the migration.
 */
export const CURATED_PRODUCT_L1_VALUES = PRODUCT_TYPE_CATEGORIES.map(
  (category) => category.slug,
) as [string, ...string[]];

/** Matches `adminReviewSchema.name`: the same editorial title bar. */
export const MAX_CURATED_PRODUCT_NAME = 200;
/** Matches `adminReviewSchema.otherUrls[].url`. */
const MAX_URL = 2_000;
/**
 * Matches `nullableText` in admin-review.ts. Exported so the admin editor can
 * NAME the ceiling in its too-long message instead of restating the number.
 */
export const MAX_NOTE = 10_000;
/** A claim is a one-line factual note, not an essay. */
const MAX_CLAIM = 1_000;
/** L2 is capped by `normalizeProductTags`; this is only a payload bound. */
const MAX_L2 = 20;
/** A product cites its provenance; it does not carry a bibliography. */
const MAX_SOURCES = 20;

export const curatedProductIdSchema = z.uuid();

/**
 * http(s) ONLY. `z.url()` alone accepts `javascript:alert(1)` — the URL
 * constructor parses it happily — and these values are rendered as hrefs on a
 * public brand page, so the protocol bar is the whole point of the check.
 */
const httpUrlSchema = z.url({ protocol: /^https?$/ }).max(MAX_URL);

const nameSchema = z.string().trim().min(1).max(MAX_CURATED_PRODUCT_NAME);
const noteSchema = z.string().max(MAX_NOTE);
const l2Schema = z.array(z.string().trim().min(1).max(100)).max(MAX_L2);
/** `timestamptz` column; an offset-bearing ISO string is what Postgres stores. */
const timestampSchema = z.iso.datetime({ offset: true });

/** The `source_type` CHECK list of `curated_product_sources`. */
export const CURATED_PRODUCT_SOURCE_TYPES = [
  "official",
  "press",
  "retailer",
  "other",
] as const;

export const curatedProductSourceSchema = z.object({
  id: curatedProductIdSchema.optional(),
  url: httpUrlSchema,
  sourceType: z.enum(CURATED_PRODUCT_SOURCE_TYPES),
  claimZh: z.string().max(MAX_CLAIM).optional(),
});

/**
 * Editorial fields only. `link_state`, `link_checked_at`, and `image_url` are
 * absent by construction: link health is written only by the link checker, and
 * the stored image URL is produced by the upload, never posted by a form.
 */
/**
 * ABSENT AND NULL MEAN DIFFERENT THINGS on every optional editorial field
 * below. An absent key is "the editor did not touch this", which leaves the
 * column alone; an explicit `null` is "clear this value", which writes NULL.
 * Without the nullable half there is no payload that can ever empty a field the
 * editor filled in by mistake — `undefined` is indistinguishable from silence.
 * `updateCuratedProduct` implements exactly this split.
 */
const curatedProductFields = {
  nameZh: nameSchema,
  nameEn: nameSchema.nullable().optional(),
  l1: z.enum(CURATED_PRODUCT_L1_VALUES),
  l2: l2Schema.optional(),
  officialUrl: httpUrlSchema.nullable().optional(),
  /** The page an image was taken from, kept so usage rights stay re-checkable. */
  imageSourceUrl: httpUrlSchema.nullable().optional(),
  /**
   * The one editorial text field, and the column behind it is NOT NULL — so
   * this is the single field of the set that is neither nullable nor blankable.
   * `.trim().min(1)` is what makes a whitespace-only textarea a field error
   * rather than a row whose description renders as an empty block.
   */
  productDescriptionZh: z.string().trim().min(1).max(MAX_NOTE),
  productDescriptionEn: noteSchema.nullable().optional(),
  productPosition: z.number().int().nonnegative().nullable().optional(),
  /**
   * Replaces `lifecycle` (DEV-1485). A product is on the site or it is not;
   * absent means "leave it alone", and the column's NOT NULL DEFAULT true is
   * what makes a create that never mentions it publish.
   */
  visible: z.boolean().optional(),
  reviewDueAt: timestampSchema.nullable().optional(),
  /**
   * A human assertion that the sources below were opened and read, which is
   * what stamps `source_checked_at`. A boolean rather than a timestamp: a form
   * that posted its own clock could back-date the check, and the promote gate
   * reads that column as evidence.
   */
  sourcesChecked: z.boolean().optional(),
  sources: z.array(curatedProductSourceSchema).max(MAX_SOURCES).optional(),
};

/**
 * NO CROSS-FIELD REFINE (removed DEV-1496). The pair it guarded — "a brand-page
 * position requires a zh rationale" — cannot fail any more: the description is
 * mandatory on every create, so a positioned product always carries text.
 */
export const curatedProductCreateSchema = z.object({
  brandId: curatedProductIdSchema,
  ...curatedProductFields,
});

/**
 * Every field optional: the editor patches what it touched. An empty object is
 * valid — `updateCuratedProduct` no-ops on an empty payload rather than
 * rewriting untouched columns with stale form state.
 */
export const curatedProductUpdateSchema = z
  .object(curatedProductFields)
  .partial()
  .superRefine((payload, ctx) => {
    // An L2 slug is only meaningful inside one L1, so a patch that moves the
    // subcategories without naming the category cannot be normalized.
    // `updateCuratedProduct` throws on the same pair, but a service throw
    // reaches the editor as its raw message; refusing at the boundary turns it
    // into the generic `{ error: "Invalid curated product" }` the action
    // returns for every other malformed payload.
    if (payload.l2 !== undefined && payload.l1 === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["l2"],
        message: "Updating l2 requires l1 in the same patch",
      });
    }
  });

/** The paste-URL field behind "Fetch details". Same protocol bar as the rest. */
export const prefillUrlSchema = httpUrlSchema;
