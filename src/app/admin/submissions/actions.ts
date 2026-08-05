"use server";

import { runWithAuditContext } from "@/lib/audit/context";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminAction } from "@/lib/auth/require-admin";
import {
  adminReviewSchema,
  reviewEntityIdSchema,
  reviewImageIdsSchema,
} from "@/lib/validation/admin-review";
import {
  cleanupSubmissionDraftImages,
  dropNeedsDataSubmissions,
  MAX_DROPPABLE_SUBMISSIONS,
  saveSubmissionReview,
  type SaveSubmissionReviewInput,
} from "@/lib/services/submissions";

type ActionResult = { error: string } | undefined;

const dropSubmissionIdsSchema = z
  .array(reviewEntityIdSchema)
  .min(1)
  .max(MAX_DROPPABLE_SUBMISSIONS)
  .refine((ids) => new Set(ids).size === ids.length);

export async function saveSubmissionReviewAction(
  submissionId: string,
  input: unknown,
): Promise<ActionResult> {
  return runWithAuditContext({}, async () => {
    const auth = await requireAdminAction();
    if ("error" in auth) return { error: auth.error };

    const idResult = reviewEntityIdSchema.safeParse(submissionId);
    const reviewResult = adminReviewSchema.safeParse(input);
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
  });
}

export async function cleanupSubmissionDraftImagesAction(
  submissionId: string,
  imageIds: unknown,
): Promise<ActionResult> {
  return runWithAuditContext({}, async () => {
    const auth = await requireAdminAction();
    if ("error" in auth) return { error: auth.error };

    const idResult = reviewEntityIdSchema.safeParse(submissionId);
    const imagesResult = reviewImageIdsSchema.safeParse(imageIds);
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
  });
}

export async function dropNeedsDataSubmissionsAction(
  submissionIds: unknown,
): Promise<
  | { deletedCount: number; storageCleanupWarning?: true }
  | { error: string }
> {
  return runWithAuditContext({}, async () => {
    const auth = await requireAdminAction();
    if ("error" in auth) return { error: auth.error };

    const idsResult = dropSubmissionIdsSchema.safeParse(submissionIds);
    if (!idsResult.success) return { error: "Invalid submission selection" };

    try {
      const result = await dropNeedsDataSubmissions(idsResult.data);
      revalidatePath("/admin");
      revalidatePath("/admin/submissions");
      return {
        deletedCount: result.deletedCount,
        ...(result.cleanupFailed ? { storageCleanupWarning: true as const } : {}),
      };
    } catch (error) {
      console.error("[admin:dropNeedsDataSubmissions]", error);
      return {
        error:
          error instanceof Error ? error.message : "Unable to drop submissions",
      };
    }
  });
}
