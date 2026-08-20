import type { Brand } from "@/lib/types";
import { auditedCall } from "@/lib/audit";
import { ValidationError } from "@/lib/errors";
import {
  DRAFT_PARK_SORT_ORDER,
  isLogoImageTags,
  MAX_BRAND_IMAGE_SELECTION,
} from "@/lib/constants/brand-images";
import { createServiceClient } from "@/lib/supabase/service";
import {
  chunkBrandIdBatches,
  fetchActiveBrandImageRows,
  type BrandImageQueryClient,
} from "./_shared/brand-image-batch";
import { deleteStoredImagePaths } from "@/lib/services/image-upload";
import {
  rejectBrandImages,
  syncHeroDenormalized,
} from "@/lib/services/brand-images";
import { getBrandById, updateBrand } from "@/lib/services/brands";
import {
  PURCHASE_CHANNELS,
  purchaseChannelByKey,
  type PurchaseChannelCamelField,
} from "@/lib/brands/purchase-channels";
import type {
  SaveSubmissionReviewInput,
  SubmissionReviewImage,
} from "@/lib/services/submissions";

type BrandImageRow = {
  id: string;
  brand_id: string;
  storage_path: string | null;
  url: string;
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
  url: string;
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
      storage_path: input.storagePath,
      url: input.url,
      source: "admin",
      source_url: input.url,
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
  if (error || !data) throw error ?? new Error("Unable to stage brand image");
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
    if (!row) throw new ValidationError("Brand image does not belong to brand");
    return { ...row, status: "active", sort_order: image.sortOrder };
  });

  const purchaseFields = Object.fromEntries(
    PURCHASE_CHANNELS.map((channel) => [
      channel.camel,
      channel === purchaseChannelByKey.website
        ? input.websiteUrl
        : input[channel.camel],
    ]),
  ) as Pick<SaveSubmissionReviewInput, PurchaseChannelCamelField>;

  await updateBrand(brandId, {
    name: input.name,
    description: input.description,
    descriptionEn: input.descriptionEn,
    blurb: input.blurb,
    blurbEn: input.blurbEn,
    city: input.city,
    reputationSummary: input.reputationSummary as Brand["reputationSummary"],
    mitEvidence: input.mitEvidence as Brand["mitEvidence"],
    siteContent: input.siteContent as Brand["siteContent"],
    foundingYear: input.foundingYear,
    categorySlug: input.categorySlug,
    priceRange: input.priceRange,
    subcategories: input.subcategories,
    subcategoriesEn: input.subcategoriesEn,
    socialInstagram: input.socialInstagram,
    socialThreads: input.socialThreads,
    socialFacebook: input.socialFacebook,
    ...purchaseFields,
    otherUrls: input.otherUrls,
  });

  const selectedIdSet = new Set(selectedIds);
  const removedActive = rows.filter(
    (row) => row.status === "active" && !selectedIdSet.has(row.id),
  );
  await rejectBrandImages(
    supabase,
    brandId,
    removedActive.map((row) => row.url),
  );

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
    url: row.url,
    source: row.source,
    status:
      row.status === "candidate" || row.status === "draft" || row.status === "rejected"
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
