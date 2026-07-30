"use client";

import type { Brand } from "@/lib/types";
import { ReviewDetailsEditor } from "@/components/admin/review-details-editor";
import { brandToReviewData } from "@/lib/brands/admin-review-data";
import type { SubmissionReviewImage } from "@/lib/services/submissions";
import {
  cleanupAdminBrandReviewImagesAction,
  saveAdminBrandReviewAction,
} from "@/app/admin/brands/actions";

export function BrandEditDetails({
  brand,
  reviewImages,
}: {
  brand: Brand;
  reviewImages: SubmissionReviewImage[];
}) {
  return (
    <ReviewDetailsEditor
      entityId={`brand-detail-${brand.id}`}
      reviewData={brandToReviewData(brand)}
      reviewImages={reviewImages}
      canEdit
      canRemovePersistedImages
      uploadPath={`brands/${brand.id}/admin`}
      uploadEndpoint={`/api/admin/brands/${brand.id}/images`}
      onSaveReview={(input) => saveAdminBrandReviewAction(brand.id, input)}
      onCleanupDraftImages={(imageIds) =>
        cleanupAdminBrandReviewImagesAction(brand.id, imageIds)
      }
    />
  );
}
