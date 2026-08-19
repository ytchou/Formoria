"use client";

import { ReviewDetailsEditor } from "@/components/admin/review-details-editor";
import type { ExistingCuratedProduct } from "@/lib/services/curated-products/proposal-diff";
import type { BrandSubmissionForReview } from "@/lib/services/submissions";
import {
  cleanupSubmissionDraftImagesAction,
  saveSubmissionReviewAction,
} from "./actions";

export function SubmissionReviewDetails({
  submission,
  existingProducts = [],
}: {
  submission: BrandSubmissionForReview;
  /**
   * The brand's curated products, when it already has some, so a proposal the
   * catalog already holds — or already rejected — does not render as new
   * (DEV-1469). A new-brand submission has no brand yet, hence the default.
   */
  existingProducts?: ExistingCuratedProduct[];
}) {
  return (
    <ReviewDetailsEditor
      entityId={`submission-review-${submission.id}`}
      reviewData={submission.reviewData}
      reviewImages={submission.reviewImages}
      existingProducts={existingProducts}
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
