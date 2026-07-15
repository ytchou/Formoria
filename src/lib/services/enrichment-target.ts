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
} {
  return target.type === "brand"
    ? { table: "brand_images", foreignKey: "brand_id", prefix: "brands" }
    : {
        table: "submission_images",
        foreignKey: "submission_id",
        prefix: "submissions",
      };
}
