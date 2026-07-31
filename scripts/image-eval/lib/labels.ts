import type {
  Disposition,
  GoldenImageEntry,
  GoldenLabel,
  GoldenLabelsFile,
  GoldenManifest,
  KeptTag,
  RejectionReason,
} from "./types";

const KEPT_TAGS = new Set<KeptTag>([
  "product",
  "lifestyle",
  "packaging",
  "logo",
]);
const REJECTION_REASONS = new Set<RejectionReason>([
  "wrong_brand",
  "time_sensitive",
  "promo_subject",
  "text_dominant",
  "low_visual_quality",
  "duplicate",
  "irrelevant",
]);

export function validateLabel(label: GoldenLabel): string[] {
  const errors: string[] = [];
  if (!label.imageId.trim()) errors.push("imageId is required");
  if (!["keep", "reject"].includes(label.disposition))
    errors.push("disposition must be keep or reject");

  if (label.disposition === "keep") {
    if (!label.tag || !KEPT_TAGS.has(label.tag))
      errors.push("kept images require one valid tag");
    if (label.reasons.length > 0)
      errors.push("kept images cannot have rejection reasons");
  }

  if (label.disposition === "reject") {
    if (label.tag !== null)
      errors.push("rejected images cannot have a kept tag");
    if (label.reasons.length === 0)
      errors.push("rejected images require at least one reason");
    for (const reason of label.reasons) {
      if (!REJECTION_REASONS.has(reason))
        errors.push(`unknown rejection reason: ${reason}`);
    }
  }

  if (new Set(label.reasons).size !== label.reasons.length)
    errors.push("rejection reasons must be unique");
  return errors;
}

export function validateLabelsForManifest(
  manifest: GoldenManifest,
  labelsFile: GoldenLabelsFile,
  split?: "dev" | "holdout",
): string[] {
  const entries = manifest.entries.filter(
    (entry) =>
      entry.captureStatus === "ready" && (!split || entry.split === split),
  );
  const errors: string[] = [];
  if (labelsFile.corpusId !== manifest.corpusId)
    errors.push("labels corpusId does not match manifest");

  const allReadyEntryIds = new Set(
    manifest.entries
      .filter((entry) => entry.captureStatus === "ready")
      .map((entry) => entry.id),
  );
  for (const entry of entries) {
    const label = labelsFile.labels[entry.id];
    if (!label) {
      errors.push(`missing label for ${entry.id}`);
      continue;
    }
    errors.push(
      ...validateLabel(label).map((error) => `${entry.id}: ${error}`),
    );
  }

  for (const imageId of Object.keys(labelsFile.labels)) {
    if (!allReadyEntryIds.has(imageId))
      errors.push(`label references unavailable or unknown image ${imageId}`);
  }
  return errors;
}

export function normalizeLabelInput(input: {
  imageId: string;
  disposition: Disposition;
  tag?: KeptTag | null;
  reasons?: RejectionReason[];
  notes?: string | null;
}): GoldenLabel {
  return {
    imageId: input.imageId,
    disposition: input.disposition,
    tag: input.disposition === "keep" ? (input.tag ?? null) : null,
    reasons:
      input.disposition === "reject" ? [...new Set(input.reasons ?? [])] : [],
    notes: input.notes?.trim() || null,
    labeledAt: new Date().toISOString(),
  };
}

export function readyEntries(manifest: GoldenManifest): GoldenImageEntry[] {
  return manifest.entries.filter(
    (entry) => entry.captureStatus === "ready" && entry.objectPath,
  );
}
