export const EVAL_SCHEMA_VERSION = 1 as const;

export const EVAL_CATEGORY_SLUGS = [
  "fashion",
  "bags-accessories",
  "jewelry",
  "beauty",
  "home",
  "food-drink",
  "crafts",
  "tech",
  "outdoor",
  "kids-pets",
] as const;

export type EvalCategory = (typeof EVAL_CATEGORY_SLUGS)[number];
export type GoldenSplit = "dev" | "holdout";
export type CaptureStatus = "ready" | "unavailable";
export type Disposition = "keep" | "reject";
export type KeptTag = string;
export type RejectionReason =
  | "wrong_brand"
  | "time_sensitive"
  | "promo_subject"
  | "text_dominant"
  | "low_visual_quality"
  | "duplicate"
  | "irrelevant";

export type GoldenRosterBrand = {
  id: string;
  slug: string;
  name: string;
  productType: EvalCategory;
  purchaseWebsite: string | null;
  split: GoldenSplit;
};

export type GoldenImageEntry = {
  id: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  category: EvalCategory;
  split: GoldenSplit;
  query: string;
  position: number;
  sourceUrl: string;
  fetchUrl: string | null;
  pageUrl: string | null;
  previewUrl: string | null;
  title: string;
  source: string | null;
  domain: string | null;
  providerWidth: number | null;
  providerHeight: number | null;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  googleUrl: string | null;
  captureStatus: CaptureStatus;
  failureReason: string | null;
  objectPath: string | null;
  checksumSha256: string | null;
  contentType: "image/webp" | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
};

export type GoldenManifest = {
  schemaVersion: typeof EVAL_SCHEMA_VERSION;
  corpusId: string;
  capturedAt: string;
  source: "serper.images";
  roster: GoldenRosterBrand[];
  entries: GoldenImageEntry[];
};

export type GoldenLabel = {
  imageId: string;
  disposition: Disposition;
  tag: KeptTag | null;
  reasons: RejectionReason[];
  notes: string | null;
  labeledAt: string;
};

export type GoldenLabelHistoryEntry = {
  revision: number;
  label: GoldenLabel;
};

export type GoldenTagDefinition = {
  slug: string;
  label: string;
  description: string;
  source: "system" | "manual";
  createdAt: string;
  createdFromImageId: string | null;
};

export type GoldenLabelsFile = {
  schemaVersion: typeof EVAL_SCHEMA_VERSION;
  corpusId: string;
  labels: Record<string, GoldenLabel>;
  history?: Record<string, GoldenLabelHistoryEntry[]>;
  tagDefinitions?: Record<string, GoldenTagDefinition>;
};

export type EvalPrediction = {
  imageId: string;
  disposition: Disposition;
  tag: KeptTag | null;
  reasons: RejectionReason[];
  score: number | null;
  error: string | null;
};

export type EvalScore = {
  corpusId: string;
  split: GoldenSplit;
  labeledCount: number;
  keepTruePositive: number;
  keepFalsePositive: number;
  keepFalseNegative: number;
  keepPrecision: number;
  keepRecall: number;
  keptTagAccuracy: number;
  acceptedWrongBrand: number;
  acceptedTimeSensitive: number;
  confusion: {
    keepKeep: number;
    keepReject: number;
    rejectKeep: number;
    rejectReject: number;
  };
};
