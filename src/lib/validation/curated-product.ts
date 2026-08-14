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
/** Matches `nullableText` in admin-review.ts. */
const MAX_NOTE = 10_000;
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
 * Editorial fields only. `lifecycle`, `link_state`, `link_checked_at`, and
 * `image_url` are absent by construction: lifecycle moves only through the
 * promote/retire actions, link health is written only by the link checker, and
 * the stored image URL is produced by the upload, never posted by a form.
 */
const curatedProductFields = {
  nameZh: nameSchema,
  nameEn: nameSchema.optional(),
  l1: z.enum(CURATED_PRODUCT_L1_VALUES),
  l2: l2Schema.optional(),
  officialUrl: httpUrlSchema.optional(),
  /** The page an image was taken from, kept so usage rights stay re-checkable. */
  imageSourceUrl: httpUrlSchema.optional(),
  /**
   * `image_usage` is a human assertion of rights. It is never inferred from a
   * successful download, so the form must send it explicitly to leave 'none'.
   */
  imageUsage: z.enum(["none", "permitted", "licensed"]).optional(),
  notesZh: noteSchema.optional(),
  notesEn: noteSchema.optional(),
  reviewDueAt: timestampSchema.optional(),
  /**
   * A human assertion that the sources below were opened and read, which is
   * what stamps `source_checked_at`. A boolean rather than a timestamp: a form
   * that posted its own clock could back-date the check, and the promote gate
   * reads that column as evidence.
   */
  sourcesChecked: z.boolean().optional(),
  sources: z.array(curatedProductSourceSchema).max(MAX_SOURCES).optional(),
};

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
  .partial();

/** The paste-URL field behind "Fetch details". Same protocol bar as the rest. */
export const prefillUrlSchema = httpUrlSchema;

export type CuratedProductCreateInput = z.infer<
  typeof curatedProductCreateSchema
>;
export type CuratedProductUpdatePayload = z.infer<
  typeof curatedProductUpdateSchema
>;
export type CuratedProductSourceInput = z.infer<
  typeof curatedProductSourceSchema
>;
