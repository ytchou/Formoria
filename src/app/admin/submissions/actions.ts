"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminAction } from "@/lib/auth/require-admin";
import {
  cleanupSubmissionDraftImages,
  saveSubmissionReview,
  type SaveSubmissionReviewInput,
} from "@/lib/services/submissions";

const nullableText = z.string().max(10_000).nullable();
const uuidSchema = z.uuid();
const imageSelectionSchema = z
  .array(
    z.object({
      id: uuidSchema,
      isHero: z.boolean(),
      sortOrder: z.number().int().min(0).max(6),
    }),
  )
  .max(7)
  .superRefine((images, context) => {
    if (new Set(images.map((image) => image.id)).size !== images.length) {
      context.addIssue({ code: "custom", message: "Duplicate images" });
    }
    if (
      new Set(images.map((image) => image.sortOrder)).size !== images.length
    ) {
      context.addIssue({ code: "custom", message: "Duplicate image order" });
    }
    const heroes = images.filter((image) => image.isHero);
    if (
      (images.length === 0 && heroes.length !== 0) ||
      (images.length > 0 && (heroes.length !== 1 || heroes[0]?.sortOrder !== 0))
    ) {
      context.addIssue({ code: "custom", message: "Invalid hero image" });
    }
  });

const reviewSchema = z.object({
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

type ActionResult = { error: string } | undefined;

export async function saveSubmissionReviewAction(
  submissionId: string,
  input: unknown,
): Promise<ActionResult> {
  const auth = await requireAdminAction();
  if ("error" in auth) return { error: auth.error };

  const idResult = uuidSchema.safeParse(submissionId);
  const reviewResult = reviewSchema.safeParse(input);
  if (!idResult.success || !reviewResult.success) {
    return { error: "Invalid submission review" };
  }

  try {
    await saveSubmissionReview(
      idResult.data,
      reviewResult.data as SaveSubmissionReviewInput,
    );
    revalidatePath("/admin/submissions");
    return undefined;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to save review",
    };
  }
}

export async function cleanupSubmissionDraftImagesAction(
  submissionId: string,
  imageIds: unknown,
): Promise<ActionResult> {
  const auth = await requireAdminAction();
  if ("error" in auth) return { error: auth.error };

  const idResult = uuidSchema.safeParse(submissionId);
  const imagesResult = z
    .array(uuidSchema)
    .max(7)
    .refine((ids) => new Set(ids).size === ids.length)
    .safeParse(imageIds);
  if (!idResult.success || !imagesResult.success) {
    return { error: "Invalid draft image cleanup" };
  }

  try {
    await cleanupSubmissionDraftImages(idResult.data, imagesResult.data);
    revalidatePath("/admin/submissions");
    return undefined;
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to clean up images",
    };
  }
}
