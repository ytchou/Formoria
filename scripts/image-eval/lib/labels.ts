import type {
  Disposition,
  GoldenImageEntry,
  GoldenLabel,
  GoldenLabelHistoryEntry,
  GoldenLabelsFile,
  GoldenManifest,
  GoldenTagDefinition,
  KeptTag,
  RejectionReason,
} from "./types";

const REJECTION_REASONS = new Set<RejectionReason>([
  "wrong_brand",
  "time_sensitive",
  "promo_subject",
  "text_dominant",
  "low_visual_quality",
  "duplicate",
  "irrelevant",
]);
const RESERVED_TAGS = new Set(["promo", "text_banner", "irrelevant"]);

const SYSTEM_TAGS: GoldenTagDefinition[] = [
  {
    slug: "product",
    label: "Product",
    description: "Clear presentation of the brand's product itself.",
    source: "system",
    createdAt: "2026-08-01T00:00:00.000Z",
    createdFromImageId: null,
  },
  {
    slug: "lifestyle",
    label: "Lifestyle",
    description: "Product shown in a real use or lifestyle context.",
    source: "system",
    createdAt: "2026-08-01T00:00:00.000Z",
    createdFromImageId: null,
  },
  {
    slug: "packaging",
    label: "Packaging",
    description: "Brand packaging, box, tag, or product set packaging.",
    source: "system",
    createdAt: "2026-08-01T00:00:00.000Z",
    createdFromImageId: null,
  },
  {
    slug: "logo",
    label: "Logo",
    description: "Clean, recognizable brand logo or identity image.",
    source: "system",
    createdAt: "2026-08-01T00:00:00.000Z",
    createdFromImageId: null,
  },
];

export function defaultTagDefinitions(): Record<string, GoldenTagDefinition> {
  return Object.fromEntries(
    SYSTEM_TAGS.map((definition) => [definition.slug, { ...definition }]),
  );
}

export function normalizeTagSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function hydrateTagDefinitions(
  labelsFile: GoldenLabelsFile,
): GoldenLabelsFile {
  const tagDefinitions = {
    ...defaultTagDefinitions(),
    ...(labelsFile.tagDefinitions ?? {}),
  };
  for (const label of Object.values(labelsFile.labels)) {
    if (!label.tag || tagDefinitions[label.tag]) continue;
    tagDefinitions[label.tag] = {
      slug: label.tag,
      label: label.tag,
      description: "Legacy tag; define before the final LLM evaluation.",
      source: "manual",
      createdAt: label.labeledAt,
      createdFromImageId: label.imageId,
    };
  }
  return { ...labelsFile, tagDefinitions };
}

export function registerTagDefinition(
  labelsFile: GoldenLabelsFile,
  input: {
    slug: string;
    label: string;
    description: string;
    createdFromImageId: string | null;
  },
): { labelsFile: GoldenLabelsFile; tag: GoldenTagDefinition } {
  const hydrated = hydrateTagDefinitions(labelsFile);
  const slug = normalizeTagSlug(input.slug || input.label);
  const label = input.label.trim();
  const description = input.description.trim();
  if (!slug)
    throw new Error("tag slug must contain at least one letter or number");
  if (!label) throw new Error("tag label is required");
  if (!description) throw new Error("tag description is required");
  if (RESERVED_TAGS.has(slug)) throw new Error(`tag slug is reserved: ${slug}`);
  if (hydrated.tagDefinitions?.[slug])
    throw new Error(`tag already exists: ${slug}`);

  const tag: GoldenTagDefinition = {
    slug,
    label,
    description,
    source: "manual",
    createdAt: new Date().toISOString(),
    createdFromImageId: input.createdFromImageId,
  };
  return {
    labelsFile: {
      ...hydrated,
      tagDefinitions: { ...(hydrated.tagDefinitions ?? {}), [slug]: tag },
    },
    tag,
  };
}

export function validateLabel(
  label: GoldenLabel,
  tagDefinitions: Record<string, GoldenTagDefinition> = defaultTagDefinitions(),
): string[] {
  const errors: string[] = [];
  if (!label.imageId.trim()) errors.push("imageId is required");
  if (!["keep", "reject"].includes(label.disposition))
    errors.push("disposition must be keep or reject");

  if (label.disposition === "keep") {
    if (!label.tag || !tagDefinitions[label.tag])
      errors.push("kept images require one registered primary tag");
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
      ...validateLabel(label, labelsFile.tagDefinitions).map(
        (error) => `${entry.id}: ${error}`,
      ),
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

export function hydrateLabelsFile(
  labelsFile: GoldenLabelsFile,
): GoldenLabelsFile {
  return hydrateLabelHistory(hydrateTagDefinitions(labelsFile));
}

export function hydrateLabelHistory(
  labelsFile: GoldenLabelsFile,
): GoldenLabelsFile {
  const history = { ...(labelsFile.history ?? {}) };
  for (const [imageId, label] of Object.entries(labelsFile.labels)) {
    const revisions = history[imageId] ?? [];
    if (revisions.length === 0) {
      history[imageId] = [
        { revision: 1, label } satisfies GoldenLabelHistoryEntry,
      ];
    }
  }
  return { ...labelsFile, history };
}

export function appendLabelRevision(
  labelsFile: GoldenLabelsFile,
  label: GoldenLabel,
): GoldenLabelsFile {
  const hydrated = hydrateLabelHistory(labelsFile);
  const revisions = hydrated.history?.[label.imageId] ?? [];
  return {
    ...hydrated,
    labels: { ...hydrated.labels, [label.imageId]: label },
    history: {
      ...(hydrated.history ?? {}),
      [label.imageId]: [
        ...revisions,
        { revision: revisions.length + 1, label },
      ],
    },
  };
}

export function readyEntries(manifest: GoldenManifest): GoldenImageEntry[] {
  return manifest.entries.filter(
    (entry) => entry.captureStatus === "ready" && entry.objectPath,
  );
}
