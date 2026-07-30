"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/require-admin";
import {
  adminReviewSchema,
  reviewEntityIdSchema,
  reviewImageIdsSchema,
} from "@/lib/validation/admin-review";
import {
  cleanupSubmissionDraftImages,
  saveSubmissionReview,
  type SaveSubmissionReviewInput,
} from "@/lib/services/submissions";

type ActionResult = { error: string } | undefined;

export async function saveSubmissionReviewAction(
  submissionId: string,
  input: unknown,
): Promise<ActionResult> {
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
}

export async function cleanupSubmissionDraftImagesAction(
  submissionId: string,
  imageIds: unknown,
): Promise<ActionResult> {
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
}
