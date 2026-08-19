import { z } from "zod";
import { MAX_BRAND_IMAGE_SELECTION } from "@/lib/constants/brand-images";
import {
  PURCHASE_CAMEL_FIELDS,
  type PurchaseChannelCamelField,
} from "@/lib/brands/purchase-channels";
import {
  curatedProductProposalSchema,
  MAX_CURATED_PRODUCT_PROPOSALS,
} from "@/lib/validation/curated-product";

const nullableText = z.string().max(10_000).nullable();
const purchaseFieldSchemas = Object.fromEntries(
  PURCHASE_CAMEL_FIELDS.map((field) => [field, nullableText]),
) as { [Field in PurchaseChannelCamelField]: typeof nullableText };
export const reviewEntityIdSchema = z.uuid();

// Bounded by the submission cap, not the display cap: legacy brands carry more
// active images than MAX_BRAND_ACTIVE_IMAGES, and the form submits all of them.
// See MAX_BRAND_IMAGE_SELECTION for why a tighter bound blocks the save.
const imageSelectionSchema = z
  .array(
    z.object({
      id: reviewEntityIdSchema,
      sortOrder: z
        .number()
        .int()
        .min(0)
        .max(MAX_BRAND_IMAGE_SELECTION - 1),
    }),
  )
  .max(MAX_BRAND_IMAGE_SELECTION)
  .superRefine((images, context) => {
    if (new Set(images.map((image) => image.id)).size !== images.length) {
      context.addIssue({ code: "custom", message: "Duplicate images" });
    }
    if (
      new Set(images.map((image) => image.sortOrder)).size !== images.length
    ) {
      context.addIssue({ code: "custom", message: "Duplicate image order" });
    }
  });

export const adminReviewSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: nullableText,
  descriptionEn: nullableText,
  blurb: nullableText,
  blurbEn: nullableText,
  city: z.string().max(200).nullable(),
  reputationSummary: z.unknown().nullable(),
  mitEvidence: z.unknown().nullable(),
  siteContent: z.unknown().nullable(),
  foundingYear: z.number().int().min(1800).max(2200).nullable(),
  heroImageUrl: nullableText,
  categorySlug: z.string().max(100).nullable(),
  priceRange: z.number().int().nullable(),
  subcategories: z.array(z.string().trim().min(1).max(100)).max(5),
  subcategoriesEn: z.array(z.string().trim().min(1).max(100)).max(5),
  websiteUrl: nullableText,
  socialInstagram: nullableText,
  socialThreads: nullableText,
  socialFacebook: nullableText,
  ...purchaseFieldSchemas,
  otherUrls: z
    .array(
      z.object({
        label: z.string().trim().max(100),
        url: z.string().trim().max(2_000),
      }),
    )
    .max(20),
  /**
   * Curated-product proposals and the reviewer's tick set (DEV-1469). BOTH must
   * be declared here or they never reach the service: `z.object` strips unknown
   * keys, so an undeclared field is dropped in silence — the review would look
   * saved and materialize the machine's original proposals at approval.
   *
   * Optional, not defaulted. Absent means "this save did not touch products",
   * which is what a save from any other section is; an empty array means the
   * reviewer kept nothing.
   */
  products: z
    .array(curatedProductProposalSchema)
    .max(MAX_CURATED_PRODUCT_PROPOSALS)
    .optional(),
  keptProductKeys: z
    .array(z.string().trim().min(1).max(200))
    .max(MAX_CURATED_PRODUCT_PROPOSALS)
    .optional(),
  images: imageSelectionSchema,
});

// Also a payload bound, not a display cap: this carries the draft image ids
// being cleaned up, which can exceed the number a brand will end up showing.
export const reviewImageIdsSchema = z
  .array(reviewEntityIdSchema)
  .max(MAX_BRAND_IMAGE_SELECTION)
  .refine((ids) => new Set(ids).size === ids.length);
