import { z } from "zod";

const nullableText = z.string().max(10_000).nullable();
export const reviewEntityIdSchema = z.uuid();

/**
 * Upper bound on how many images a single review save may submit.
 *
 * This is deliberately wider than the 7-image UI upload ceiling: brands
 * enriched before that ceiling existed carry up to 14 active images, and
 * `saveAdminBrandReview` rejects every active image missing from the payload.
 * A tighter bound here does not trim the gallery — it blocks the save outright
 * (and truncating to fit would permanently reject the surplus images instead).
 */
export const MAX_REVIEW_IMAGE_SELECTION = 24;

const imageSelectionSchema = z
  .array(
    z.object({
      id: reviewEntityIdSchema,
      sortOrder: z
        .number()
        .int()
        .min(0)
        .max(MAX_REVIEW_IMAGE_SELECTION - 1),
    }),
  )
  .max(MAX_REVIEW_IMAGE_SELECTION)
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
  categoryAttributes: z.unknown().nullable(),
  reputationSummary: z.unknown().nullable(),
  retailLocations: z.unknown().nullable().optional(),
  mitEvidence: z.unknown().nullable(),
  siteContent: z.unknown().nullable(),
  foundingYear: z.number().int().min(1800).max(2200).nullable(),
  heroImageUrl: nullableText,
  productType: z.string().max(100).nullable(),
  priceRange: z.number().int().nullable(),
  productTags: z.array(z.string().trim().min(1).max(100)).max(5),
  productTagsEn: z.array(z.string().trim().min(1).max(100)).max(5),
  websiteUrl: nullableText,
  socialInstagram: nullableText,
  socialThreads: nullableText,
  socialFacebook: nullableText,
  purchaseWebsite: nullableText,
  purchasePinkoi: nullableText,
  purchaseShopee: nullableText,
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

export const reviewImageIdsSchema = z
  .array(reviewEntityIdSchema)
  .max(7)
  .refine((ids) => new Set(ids).size === ids.length);
