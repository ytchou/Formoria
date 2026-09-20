import {
  BRAND_IMAGES_BUCKET,
  BRAND_SUBMISSIONS_BUCKET,
} from "@/lib/images/storage-keys";

export type EnrichmentTarget = {
  type: "brand" | "submission";
  id: string;
};

export function brandTarget(id: string): EnrichmentTarget {
  return { type: "brand", id };
}

export function targetForeignKey(target: EnrichmentTarget): {
  brand_id: string | null;
  submission_id: string | null;
} {
  return target.type === "brand"
    ? { brand_id: target.id, submission_id: null }
    : { brand_id: null, submission_id: target.id };
}

export function targetImageStorage(target: EnrichmentTarget): {
  table: "brand_images" | "submission_images";
  foreignKey: "brand_id" | "submission_id";
  prefix: "brands" | "submissions";
  bucket: typeof BRAND_IMAGES_BUCKET | typeof BRAND_SUBMISSIONS_BUCKET;
} {
  return target.type === "brand"
    ? {
        table: "brand_images",
        foreignKey: "brand_id",
        prefix: "brands",
        bucket: BRAND_IMAGES_BUCKET,
      }
    : {
        table: "submission_images",
        foreignKey: "submission_id",
        prefix: "submissions",
        bucket: BRAND_SUBMISSIONS_BUCKET,
      };
}
