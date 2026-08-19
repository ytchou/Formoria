import { z } from "zod";
import { MAX_BRAND_IMAGE_SELECTION } from "@/lib/constants/brand-images";
import { isKnownSubcategoryTerm } from "@/lib/taxonomy/ontology";
import {
  PURCHASE_CAMEL_FIELDS,
  type PurchaseChannelCamelField,
} from "@/lib/brands/purchase-channels";

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
  // Closed vocabulary since DEV-1510. The review editor picks from the 175
  // nodes, so a value the vocabulary does not know reached this payload past
  // the picker — and `brands.subcategories` is a slug column, where it would
  // render as a dead filter. Both bases are accepted: a submission created
  // before the backfill still carries zh-TW labels into review.
  subcategories: z
    .array(z.string().trim().min(1).max(100))
    .max(5)
    .refine((values) => values.every(isKnownSubcategoryTerm), {
      message: "Unknown subcategory",
    }),
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
  images: imageSelectionSchema,
});

// Also a payload bound, not a display cap: this carries the draft image ids
// being cleaned up, which can exceed the number a brand will end up showing.
export const reviewImageIdsSchema = z
  .array(reviewEntityIdSchema)
  .max(MAX_BRAND_IMAGE_SELECTION)
  .refine((ids) => new Set(ids).size === ids.length);
