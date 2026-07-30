"use client";

import { ReviewDetailsEditor } from "@/components/admin/review-details-editor";
import type { BrandSubmissionForReview } from "@/lib/services/submissions";
import {
  cleanupSubmissionDraftImagesAction,
  saveSubmissionReviewAction,
} from "./actions";

export function SubmissionReviewDetails({
  submission,
}: {
  submission: BrandSubmissionForReview;
}) {
  return (
    <ReviewDetailsEditor
      entityId={`submission-review-${submission.id}`}
      reviewData={submission.reviewData}
      reviewImages={submission.reviewImages}
      canEdit={submission.status === "pending"}
      missingFields={
        submission.status === "pending"
          ? submission.reviewCompleteness.missingFields
          : []
      }
      uploadPath={`submissions/${submission.id}`}
      uploadEndpoint={`/api/admin/submissions/${submission.id}/images`}
      onSaveReview={(input) => saveSubmissionReviewAction(submission.id, input)}
      onCleanupDraftImages={(imageIds) =>
        cleanupSubmissionDraftImagesAction(submission.id, imageIds)
      }
    />
  );
}
