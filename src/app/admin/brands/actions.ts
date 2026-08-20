"use server";

import { runWithAuditContext } from "@/lib/audit/context";
import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/require-admin";
import { revalidatePublicBrands } from "@/lib/cache/public-brand-cache";
import { getBrandById } from "@/lib/services/brands";
import { saveModerationFlags, scanContent } from "@/lib/services/moderation";
import {
  cleanupAdminBrandReviewImages,
  saveAdminBrandReview,
} from "@/lib/services/admin-brand-review";
import type { SaveSubmissionReviewInput } from "@/lib/services/submissions";
import {
  adminReviewSchema,
  reviewEntityIdSchema,
  reviewImageIdsSchema,
} from "@/lib/validation/admin-review";
import { PURCHASE_CHANNELS } from "@/lib/brands/purchase-channels";
import { routes } from "@/lib/routes";

type ActionResult = { error: string } | undefined;

export async function saveAdminBrandReviewAction(
  brandId: string,
  input: unknown,
): Promise<ActionResult> {
  return runWithAuditContext({}, async () => {
    const auth = await requireAdminAction();
    if ("error" in auth) return { error: auth.error };

    const idResult = reviewEntityIdSchema.safeParse(brandId);
    const reviewResult = adminReviewSchema.safeParse(input);
    if (!idResult.success || !reviewResult.success) {
      return { error: "Invalid brand review" };
    }

    try {
      const previous = await getBrandById(idResult.data);
      const review = reviewResult.data;
      const { violations } = scanContent(review.name, {
        name: review.name,
        description: review.description ?? undefined,
        socialInstagram: review.socialInstagram ?? undefined,
        socialThreads: review.socialThreads ?? undefined,
        socialFacebook: review.socialFacebook ?? undefined,
        purchaseWebsite: review.websiteUrl ?? undefined,
        ...Object.fromEntries(
          PURCHASE_CHANNELS.filter((channel) => channel.key !== "website").map(
            (channel) => [channel.camel, review[channel.camel] ?? undefined],
          ),
        ),
      });
      if (violations.length > 0) {
        try {
          await saveModerationFlags(
            idResult.data,
            auth.user.id,
            violations,
            "pending",
          );
        } catch (error) {
          console.error(
            "[admin:saveBrandReview] moderation audit failed",
            error,
          );
        }
        return {
          error: violations
            .map((violation) => violation.userMessage)
            .join(". "),
        };
      }
      await saveAdminBrandReview(
        idResult.data,
        review as SaveSubmissionReviewInput,
      );
      const updated = await getBrandById(idResult.data);
      revalidatePath(routes.admin.brands());
      revalidatePath(routes.admin.index());
      revalidatePublicBrands([updated.slug, previous.slug]);
      return undefined;
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save brand review",
      };
    }
  });
}

export async function cleanupAdminBrandReviewImagesAction(
  brandId: string,
  imageIds: unknown,
): Promise<ActionResult> {
  return runWithAuditContext({}, async () => {
    const auth = await requireAdminAction();
    if ("error" in auth) return { error: auth.error };

    const idResult = reviewEntityIdSchema.safeParse(brandId);
    const imagesResult = reviewImageIdsSchema.safeParse(imageIds);
    if (!idResult.success || !imagesResult.success) {
      return { error: "Invalid draft image cleanup" };
    }

    try {
      await cleanupAdminBrandReviewImages(idResult.data, imagesResult.data);
      return undefined;
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Unable to clean up images",
      };
    }
  });
}
