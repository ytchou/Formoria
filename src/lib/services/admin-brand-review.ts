import type { Brand } from "@/lib/types";
import { auditedCall } from "@/lib/audit";
import { ValidationError } from "@/lib/errors";
import {
  DRAFT_PARK_SORT_ORDER,
  isLogoImageTags,
  MAX_BRAND_IMAGE_SELECTION,
} from "@/lib/constants/brand-images";
import { createServiceClient } from "@/lib/supabase/service";
import { imagePathToUrl } from "@/lib/images/image-url";
import {
  chunkBrandIdBatches,
  fetchActiveBrandImageRows,
  type BrandImageQueryClient,
} from "./_shared/brand-image-batch";
import {
  deleteStoredImagePaths,
  storageKeyFromPublicUrlForRead,
} from "@/lib/services/image-upload";
import {
  rejectBrandImages,
  syncHeroDenormalized,
} from "@/lib/services/brand-images";
import { getBrandById, updateBrand } from "@/lib/services/brands";
import {
  ONLINE_STORES,
  onlineStoreByKey,
  type OnlineStoreCamelField,
} from "@/lib/brands/online-stores";
import type {
  SaveSubmissionReviewInput,
  SubmissionReviewImage,
} from "@/lib/services/submissions";

type BrandImageRow = {
  id: string;
  brand_id: string;
  storage_path: string | null;
  /**
   * Legacy public storage URL, NOT NULL on the table. Selected read-only: the
   * 20260708100000 backfill inserted rows with `url` populated from
   * `brands.hero_image_url` and `storage_path` NULL, and those rows are only
   * addressable through it. Never written back — see `toPersistableRow`.
   */
  url: string | null;
  source: string;
  status: string;
  sort_order: number;
  alt_zh: string | null;
  alt_en: string | null;
  tags: string[] | null;
  width: number | null;
  height: number | null;
  source_url: string | null;
};

const ADMIN_BRAND_IMAGE_SELECT =
  "id, brand_id, storage_path, url, source, status, sort_order, alt_zh, alt_en, tags, width, height, source_url";

/**
 * Drops the legacy `url` column from a row before it goes back into an upsert.
 * The column is read-only since DEV-1551: nothing in TypeScript writes it, and
 * a spread of the selected row would quietly reinstate that write.
 */
function toPersistableRow({
  url: _legacyUrl,
  ...rest
}: BrandImageRow): Omit<BrandImageRow, "url"> {
  return rest;
}

/**
 * The `/i/<key>` references `rejectBrandImages` keys on, one per row.
 *
 * `storage_path` is the modern reference, but it is NULL on every row the
 * 20260708100000 backfill created, and `rejectBrandImages` returns early on an
 * empty list — so deriving the key from `storage_path` alone left a legacy row
 * `status = 'active'` forever while the UI reported the save had succeeded.
 * `storageKeyFromPublicUrlForRead` is the fail-open recovery for exactly that
 * direction. A row neither path can address is surfaced, never skipped.
 */
export function brandImageRejectRefs(
  rows: readonly Pick<BrandImageRow, "id" | "storage_path" | "url">[],
): string[] {
  const unrecoverable: string[] = [];
  const refs = rows.flatMap((row) => {
    const key =
      row.storage_path ??
      (row.url ? storageKeyFromPublicUrlForRead(row.url) : null);
    const ref = imagePathToUrl(key);
    if (!ref) {
      unrecoverable.push(row.id);
      return [];
    }
    return [ref];
  });

  if (unrecoverable.length > 0) {
    throw new ValidationError(
      `Cannot resolve a storage reference for brand image(s): ${unrecoverable.join(", ")}`,
    );
  }

  return refs;
}

export async function getAdminBrandReviewImages(
  brandIds: string[],
): Promise<Record<string, SubmissionReviewImage[]>> {
  const uniqueBrandIds = [...new Set(brandIds)];
  if (uniqueBrandIds.length === 0) return {};

  const supabase = createServiceClient();
  // Unnarrowed on purpose, unlike `hydrateCardImageMeta`: the review screen
  // needs every active row for a brand, not just the hero. Throws on error,
  // also on purpose — an admin editing a gallery must never be shown a
  // silently-partial one.
  const rows = await fetchActiveBrandImageRows<BrandImageRow>(
    supabase as unknown as BrandImageQueryClient,
    ADMIN_BRAND_IMAGE_SELECT,
    chunkBrandIdBatches(uniqueBrandIds),
  );

  const result: Record<string, SubmissionReviewImage[]> = {};
  for (const row of rows) {
    (result[row.brand_id] ??= []).push(toReviewImage(row));
  }
  return result;
}

export async function stageAdminBrandReviewImage(input: {
  brandId: string;
  storagePath: string;
  width: number;
  height: number;
}): Promise<SubmissionReviewImage> {
  return auditedCall(
    {
      provider: "brands",
      operation: "stageAdminBrandReviewImage",
      kind: "service",
    },
    async () => {
      await getBrandById(input.brandId);
      const supabase = createServiceClient();
      const id = crypto.randomUUID();
      const { data, error } = await supabase
        .from("brand_images")
        .insert({
          id,
          brand_id: input.brandId,
          // DEV-1551 task 12: the bucket key is the only reference written.
          storage_path: input.storagePath,
          source: "admin",
          source_url: input.storagePath,
          status: "draft",
          // Parked above every active row until the reviewer places the image, so
          // it can never collide with a real gallery position. See
          // DRAFT_PARK_SORT_ORDER for the invariant.
          sort_order: DRAFT_PARK_SORT_ORDER,
          width: input.width,
          height: input.height,
        })
        .select(ADMIN_BRAND_IMAGE_SELECT)
        .single();
      if (error || !data)
        throw error ?? new Error("Unable to stage brand image");
      return toReviewImage(data as BrandImageRow);
    },
    { subjectId: input.brandId },
  );
}

export async function cleanupAdminBrandReviewImages(
  brandId: string,
  imageIds: string[],
): Promise<void> {
  if (imageIds.length === 0) return;

  return auditedCall(
    {
      provider: "brands",
      operation: "cleanupAdminBrandReviewImages",
      kind: "service",
    },
    async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("brand_images")
        .select(ADMIN_BRAND_IMAGE_SELECT)
        .eq("brand_id", brandId)
        .eq("status", "draft")
        .in("id", imageIds);
      if (error) throw error;

      const rows = (data ?? []) as BrandImageRow[];
      await deleteStoredImagePaths(
        rows.flatMap((row) => (row.storage_path ? [row.storage_path] : [])),
      );
      if (rows.length > 0) {
        const { error: deleteError } = await supabase
          .from("brand_images")
          .delete()
          .eq("brand_id", brandId)
          .in(
            "id",
            rows.map((row) => row.id),
          );
        if (deleteError) throw deleteError;
      }
    },
    { subjectId: brandId, summary: { imageCount: imageIds.length } },
  );
}

export async function saveAdminBrandReview(
  brandId: string,
  input: SaveSubmissionReviewInput,
): Promise<void> {
  return auditedCall(
    {
      provider: "brands",
      operation: "saveAdminBrandReview",
      kind: "service",
    },
    async () => {
      const selectedIds = input.images.map((image) => image.id);
      if (
        // Bounded by the submission cap, matching `adminReviewSchema`: if this
        // guard and the schema disagree, one rejects a save the other accepted.
        selectedIds.length > MAX_BRAND_IMAGE_SELECTION ||
        new Set(selectedIds).size !== selectedIds.length
      ) {
        throw new ValidationError("Invalid brand image selection");
      }

      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("brand_images")
        .select(ADMIN_BRAND_IMAGE_SELECT)
        .eq("brand_id", brandId)
        .in("status", ["active", "draft"]);
      if (error) throw error;
      const rows = (data ?? []) as BrandImageRow[];
      const rowsById = new Map(rows.map((row) => [row.id, row]));
      const selectedRows = input.images.map((image) => {
        const row = rowsById.get(image.id);
        if (!row)
          throw new ValidationError("Brand image does not belong to brand");
        return {
          ...toPersistableRow(row),
          status: "active",
          sort_order: image.sortOrder,
        };
      });

      // Derived BEFORE `updateBrand`, so an unaddressable row aborts the save
      // instead of leaving the brand fields written and its image rejection
      // silently skipped.
      const selectedIdSet = new Set(selectedIds);
      const removedActiveRefs = brandImageRejectRefs(
        rows.filter(
          (row) => row.status === "active" && !selectedIdSet.has(row.id),
        ),
      );

      const purchaseFields = Object.fromEntries(
        ONLINE_STORES.map((channel) => [
          channel.camel,
          channel === onlineStoreByKey.website
            ? input.websiteUrl
            : input[channel.camel],
        ]),
      ) as Pick<SaveSubmissionReviewInput, OnlineStoreCamelField>;

      await updateBrand(brandId, {
        name: input.name,
        description: input.description,
        descriptionEn: input.descriptionEn,
        blurb: input.blurb,
        blurbEn: input.blurbEn,
        city: input.city,
        reputationSummary:
          input.reputationSummary as Brand["reputationSummary"],
        mitEvidence: input.mitEvidence as Brand["mitEvidence"],
        siteContent: input.siteContent,
        foundingYear: input.foundingYear,
        categorySlug: input.categorySlug,
        subcategories: input.subcategories,
        subcategoriesEn: input.subcategoriesEn,
        socialInstagram: input.socialInstagram,
        socialThreads: input.socialThreads,
        socialFacebook: input.socialFacebook,
        ...purchaseFields,
        otherUrls: input.otherUrls,
      });

      await rejectBrandImages(supabase, brandId, removedActiveRefs);

      if (selectedRows.length > 0) {
        const { error: upsertError } = await supabase
          .from("brand_images")
          .upsert(selectedRows, { onConflict: "id" });
        if (upsertError) throw upsertError;
      }

      const unusedDrafts = rows.filter(
        (row) => row.status === "draft" && !selectedIdSet.has(row.id),
      );
      await cleanupAdminBrandReviewImages(
        brandId,
        unusedDrafts.map((row) => row.id),
      );
      await syncHeroDenormalized(supabase, brandId);
    },
    { subjectId: brandId, summary: { imageCount: input.images.length } },
  );
}

function toReviewImage(row: BrandImageRow): SubmissionReviewImage {
  return {
    id: row.id,
    submissionId: row.brand_id,
    storagePath: row.storage_path,
    // Published brand imagery, so the same-origin proxy serves it (DEV-1551).
    url: imagePathToUrl(row.storage_path) ?? "",
    source: row.source,
    status:
      row.status === "candidate" ||
      row.status === "draft" ||
      row.status === "rejected"
        ? row.status
        : "active",
    sortOrder: row.sort_order,
    altZh: row.alt_zh,
    altEn: row.alt_en,
    isLogo: isLogoImageTags(row.tags),
    width: row.width,
    height: row.height,
    originBrandImageId: row.status === "draft" ? null : row.id,
  };
}
