import { z } from "zod";
import { auditedCall, type AuditCallContext } from "@/lib/audit";
import { IMAGE_CLASSIFY_SYSTEM_PROMPT } from "@/lib/prompts/classify-images";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import {
  BRAND_IMAGE_LOGO_TAG,
  HERO_TARGET_RATIO,
  isLogoImageTags,
  MAX_BRAND_ACTIVE_IMAGES,
} from "@/lib/constants/brand-images";
import {
  rank,
  heroQualityForAspect,
  cropDamagePenaltyForAspect,
} from "./image-ranking";
import { fetchLangfusePrompt } from "@/lib/langfuse/prompt";
import type { OpenAIChatResult } from "../openai-client";
import {
  parseAndValidate,
  toStrictJsonSchema,
  formatRetryInstruction,
} from "../_shared/zod-schema";
import {
  buildProfiledEnrichmentConfig,
  createProfiledOpenAIClient,
  profileChatParams,
} from "../llm-audit";
import { syncHeroDenormalized, type BrandImageRow } from "../brand-images";
import { visionStorageKey, encodeVisionDownload } from "../vision-image";
import { mapWithConcurrency } from "../_shared/concurrency";
import { createServiceClient } from "@/lib/supabase/service";
import type { PhaseResult } from "@/lib/types/curation";
import {
  brandTarget,
  targetImageStorage,
  type EnrichmentTarget,
} from "../_shared/enrichment-target";
import {
  buildPhaseResult,
  timePhase,
  type EnrichBrand,
  type EnrichPhase,
} from "./types";
import type { EnrichPatch } from "./types";
import { preferPatched } from "./descriptions";

/**
 * A middle setting between the twenty that failed and the five that followed.
 *
 * Twenty let one uncertain verdict propagate across the whole batch — measured
 * once as all ten of a brand's images flipping to wrong_brand in a single run
 * and back the next. Five was the correction. Nothing in the contract spans
 * images any more (see REJECTION_REASONS) and the prompt's INDEPENDENCE section
 * states the rule explicitly, so batch length is a cost and stability knob
 * rather than a correctness one.
 *
 * The cost direction was previously recorded here backwards — "extra calls cost
 * only the repeated system prompt, which image tokens dwarf". Measured on job
 * a566f716 (2026-08-03) it is the reverse: regressing prompt_tokens on image
 * count gives ~270 tokens per image against ~2,180 fixed per call, because the
 * system prompt is ~2,300 tokens. At five per batch a 24-image brand spent 66%
 * of its classification input re-sending the same prompt. Ten halves that
 * overhead; going higher trades into the contamination the twenty-image batch
 * demonstrated, so this stops at ten.
 */
export const IMAGE_CLASSIFY_BATCH_SIZE = 10;

const IMAGE_DOWNLOAD_CONCURRENCY = 4;
const BRAND_IMAGES_BUCKET = "brand-images";

async function loadVisionDataUri(image: {
  storage_path?: string | null;
  url?: string | null;
}): Promise<string | null> {
  const key = visionStorageKey(image);
  if (!key) return null;
  return auditedCall(
    { provider: "images", operation: "loadVisionImage", kind: "service" },
    async (ctx) => {
      ctx.summary.key = key;
      try {
        const supabase = createServiceClient();
        const { data, error } = await supabase.storage
          .from(BRAND_IMAGES_BUCKET)
          .download(key);
        ctx.summary.bytes = data?.size ?? null;
        return await encodeVisionDownload(key, { data, error });
      } catch (error) {
        console.error("[vision-image] load failed", { key, error });
        ctx.summary.error =
          error instanceof Error ? error.message : String(error);
        return null;
      }
    },
  );
}

/**
 * LEGACY. The seven-value vocabulary rows were written with before the
 * disposition/reasons contract landed. Kept only so `classifiedImageFromRow` and
 * `parseClassificationBatch` can still read old rows; the model is never
 * offered these values (see KEEP_TAGS, which is what feeds the schema).
 */
const IMAGE_TAGS = [
  "product",
  "lifestyle",
  "packaging",
  "logo",
  "promo",
  "text_banner",
  "irrelevant",
] as const;

/**
 * The only tags the model may return, and the only ones written to new rows.
 *
 * Collapsed from four to two: `lifestyle` and `packaging` folded into `product`
 * because the distinction never changed what we do with the image — all three
 * are "this picture is about the product" — and a four-way choice cost the model
 * accuracy on the decision that actually matters (keep vs reject).
 *   - product: the image is primarily about the product — a direct product shot,
 *     a model using it, or its packaging.
 *   - logo: brand identity / brand-story imagery — related to the brand, but not
 *     directly about the product.
 * Everything else is a rejection, which the disposition/reasons contract carries.
 */
// The `logo` member is the shared BRAND_IMAGE_LOGO_TAG rather than a second
// literal: this vocabulary and the renderers' logo carve-out must name the
// same string, and a duplicated literal is how they would drift.
const KEEP_TAGS = ["product", BRAND_IMAGE_LOGO_TAG] as const;

/**
 * LEGACY tags that are still valid images, mapped onto their modern equivalent.
 * Rows written before the collapse carry `lifestyle`/`packaging`; without this
 * map they would fail the narrowed `isKeptImageTag` check, parse as `null`, and
 * silently drop out of the hero-eligible set.
 */
const LEGACY_KEEP_TAG_ALIASES: Record<string, KeptImageTag> = {
  lifestyle: "product",
  packaging: "product",
};

/**
 * No `duplicate`. Deduplication is the download layer's job — exact-URL, then
 * Instagram-variant, then perceptual dHash — and it runs before an image is
 * ever stored. Asking the model to do it too was the last cross-image rule in
 * the prompt, and measurably the last source of instability: over three
 * identical runs every per-image verdict was reproducible while a brand's
 * `duplicate` calls flipped, discarding two good product photos in one run and
 * keeping them in the others. One layer owns dedupe.
 */
const REJECTION_REASONS = [
  "wrong_brand",
  "time_sensitive",
  "promo_subject",
  "text_dominant",
  "low_visual_quality",
  "irrelevant",
] as const;

const VALID_TAGS = new Set<string>(IMAGE_TAGS);

/**
 * LEGACY compat set. These tag values can only come from rows written before the
 * disposition/reasons contract — the model can no longer produce them. The live
 * rejection path is `disposition === 'reject'` plus `rejection_reasons`.
 */
export const JUNK_TAGS = new Set(["promo", "text_banner", "irrelevant"]);

/**
 * Hero ordering is a pure quality sort — the tag no longer participates.
 *
 * Tag-major ranking existed to stop high-scoring logos taking every hero slot,
 * but it also pinned genuinely worse product shots above genuinely better brand
 * imagery. With the vocabulary down to two tags the ranking signal has to come
 * from the score itself, corrected for shape (see `heroQuality`).
 *
 * This is a QUALITY prior, not a geometry one, and the rename is the whole
 * point. The geometry claim the old `PORTRAIT_PENALTY` comment made — "portrait
 * crops badly in the landscape hero frame" — is now computed exactly, per image,
 * by `cropDamage`. Keeping a flat penalty for that would double-charge it. What
 * survives is a separate, measured effect: portrait images are WORSE, not just
 * worse-framed.
 *
 * Measured 2026-08-08 against the labelled image-classification corpus, the
 * same 231 images the old comment cited:
 *   - Portrait share of human rejects 58.2% vs keeps 24.8% — reproduces the old
 *     "58% vs 23%" headline.
 *   - Logistic `reject ~ cropDamage + isPortrait`: the portrait residual
 *     coefficient is 1.206 (odds multiplier 3.34x), likelihood-ratio chi-square
 *     6.56 on 1 df, p < 0.05. The portrait effect SURVIVES conditioning on crop
 *     damage — it is not just a restatement of the geometry.
 *   - Stratified, in the 0.25-0.40 crop-damage band (the only band containing
 *     both groups): portraits reject at 78%, non-portraits at 34%. Same crop
 *     damage, very different outcome.
 *   - Likely mechanism is provenance, not shape: portrait web images skew toward
 *     Instagram crops, screenshots, and product-detail strips.
 *
 * CAVEAT, recorded because it bounds how much this number can be trusted:
 * portrait and crop damage are heavily collinear at a 4/3 target — 88 of the 98
 * corpus portraits sit in the top damage band, which contains zero
 * non-portraits — so the coefficient rests on a ~9-image overlap. The DIRECTION
 * is solid; the MAGNITUDE in score-points is not derivable from a log-odds
 * coefficient, which lives on a different scale entirely.
 *
 * So 6 is a documented judgement call, not a fitted value. Chosen because a
 * typical portrait already earns ~10-12 points of computed crop damage and the
 * old flat penalty was 15, making a ~16-18 point total the nearest defensible
 * neighbour of the behaviour this replaces. Ceiling: one flat number for every
 * brand, resting on a thin overlap. Upgrade path: refit against the corpus above
 * once it carries more low-damage portraits, which is the only thing that can
 * separate the two effects properly.
 *
 * Exported so tests can assert against the constant rather than a literal — see
 * the junk-promotion guard in `__tests__/classify-images.test.ts`.
 */
export const PORTRAIT_QUALITY_PRIOR = 6;

/**
 * Images a human picked. The classifier must never retag, reorder away, or
 * delete these.
 *
 * The hero re-sort scripts under `scripts/resort-heroes/` need the identical
 * rule; they get it through the exported `isExemptSource` function rather
 * than this constant, so a hand-copied `['owner', 'admin']` literal never
 * has to diverge and reorder somebody's hand-picked hero.
 */
const EXEMPT_SOURCES = new Set(["owner", "admin"]);

/**
 * sort_order doubles as the hero designation (position 0) and as the gallery
 * order. The publishability guards encode that: no duplicate sort_orders among
 * active rows, and `sort_order between 0 and MAX_BRAND_ACTIVE_SORT_ORDER` —
 * which is what caps a brand's active images. A brand may legitimately have no
 * active row at 0 while its images are being staged; the hero is whichever
 * active row holds the lowest sort_order.
 */
const MAX_ACTIVE_IMAGES = MAX_BRAND_ACTIVE_IMAGES;

/**
 * `high` tiles the image rather than capping it at 512px, which would sharpen
 * the blur and text-density judgements. It is not worth it here: gpt-4o-mini
 * bills image tokens at ~33x the standard tile rate, so a 1024px image costs
 * ~25k tokens against a 128k window, and our own download gate admits images
 * at a 480px short edge — high detail would mostly be paying to look closely
 * at upscaled pixels. Revisit if the floor rises well above 768px.
 *
 * Since DEV-1374 the 512 cap is also ours rather than the render endpoint's:
 * `visionDataUri` encodes at VISION_IMAGE_WIDTH before the bytes leave us, so
 * raising this to `high` would need that width raised too or it would only tile
 * an image we already downscaled.
 */
const CLASSIFY_IMAGE_DETAIL = "low" as const;

/**
 * Kept images must score at least this. The 231 labelled images have now said
 * what it costs: swept against gpt-5.6-luna predictions, every keep scoring
 * 40-59 was a human reject, so 60 removes three false positives and loses no
 * true keeps (precision 72.1% -> 74.1%, TP unchanged at 80). 65 is where it
 * starts costing real images — five true keeps — so 60 is the last free notch.
 *
 * Note this gate was dormant under gpt-4o-mini, whose lowest kept score was 70.
 * It only becomes load-bearing because luna spreads scores across more of the
 * scale; re-sweep if the model changes again.
 */
export const MIN_KEEP_SCORE = 60;

/**
 * Bounded fan-out for reading each chunk's bytes out of Storage before the call.
 *
 * Imported rather than restated: this is the same shape of work as the download
 * path (a storage read plus a sharp decode/resize/encode), already multiplied by
 * the per-brand enrichment concurrency above it, so the two must move together
 * and a copied literal drifts silently.
 */
const VISION_LOAD_CONCURRENCY = IMAGE_DOWNLOAD_CONCURRENCY;

/** LEGACY-inclusive union: what a stored row may carry, not what the model may emit. */
type ImageClassificationTag = (typeof IMAGE_TAGS)[number];
type KeptImageTag = (typeof KEEP_TAGS)[number];
type ImageRejectionReason = (typeof REJECTION_REASONS)[number];

type ParsedImageClassification = {
  disposition: "keep" | "reject";
  tag: KeptImageTag | null;
  reasons: ImageRejectionReason[];
  score: number;
  caption: string | null;
};

export type ClassifiedImage = {
  id: string;
  tag: ImageClassificationTag;
  score: number;
  storage_path?: string | null;
  disposition?: "keep" | "reject";
  rejectionReasons?: ImageRejectionReason[];
  /** Source dimensions. Feed the hero ranking's crop-damage term — see `heroQuality`. */
  width?: number | null;
  height?: number | null;
  /**
   * Whether the RENDERER will treat this image as a logo, i.e. whether `logo`
   * appears anywhere in the row's `tags` array — the same question
   * `isLogoImageTags` answers for every render site.
   *
   * Distinct from `tag === "logo"`, which reads only the FIRST classification
   * tag. On a row tagged `['product', 'logo']` the two disagree: ranking
   * charged crop damage while the page rendered `object-contain` and never
   * cropped it. Populated at both real construction sites; optional only so the
   * unit tests can keep building bare literals.
   */
  isLogo?: boolean;
  caption?: string | null;
  /**
   * `brand_images.source_url` — the page the image was scraped from.
   *
   * Carried from the row rather than re-derived downstream: it is what
   * `rankForProduct` filters a pool by, so a product proposal can only be given
   * an image that came from its own page. Absent when the row has no
   * provenance, which releases the image to the brand-level pool only.
   */
  sourceUrl?: string | null;
  /**
   * The image's OWN url — what a re-download fetches — as distinct from
   * `sourceUrl`, the page it was found on. `curated_products.image_source_url`
   * is fetched for bytes by `prepareCuratedProductImage`, so a page URL there
   * is a dead image.
   *
   * Filled at both row-backed construction sites (`classifiedImageFromRow` and
   * the chunk write plan) from `brand_images.url`. Optional because a caller
   * holding a freshly ranked candidate may not have persisted it yet.
   */
  imageUrl?: string | null;
};

export const imageClassificationShape = z.object({
  classifications: z.array(
    z.object({
      id: z.string(),
      disposition: z.enum(["keep", "reject"]),
      tag: z.enum(KEEP_TAGS).nullable(),
      reasons: z.array(z.enum(REJECTION_REASONS)),
      score: z.number(),
      caption: z.string().nullable(),
    }),
  ),
});

export const IMAGE_CLASSIFICATION_SCHEMA = {
  name: "image_classifications",
  schema: toStrictJsonSchema(imageClassificationShape),
};

type ClassifyImagesPhaseOptions = {
  brand: EnrichBrand;
  phases: EnrichPhase[];
  dryRun?: boolean;
  overwrite?: boolean;
  target?: EnrichmentTarget;
  jobId?: string;
  pendingPatch?: EnrichPatch;
};

type ClassifyImagesPhaseOutput = {
  phaseResult: PhaseResult;
  patch: Record<string, unknown>;
};

export type BrandImageForClassification = BrandImageRow & {
  id: string;
};

export type HeroResortPlan = {
  assignments: Array<{ id: string; sortOrder: number }>;
  candidateIds: string[];
  demotedIds: string[];
  rejectedUpdates: ReturnType<typeof applyClassifications>["rejectedUpdates"];
  ranked: Array<{
    id: string;
    score: number;
    cropDamage: number;
    heroQuality: number;
  }>;
  skipReason:
    null | "junk_tagged_active" | "over_capacity" | "no_managed_images";
};

type BrandImagesSelectQuery = {
  eq: (column: string, value: string) => BrandImagesSelectQuery;
  neq: (column: string, value: string) => BrandImagesSelectQuery;
  in: (column: string, values: string[]) => BrandImagesSelectQuery;
  is: (column: string, value: null) => BrandImagesSelectQuery;
  order: (
    column: string,
    options: { ascending: boolean },
  ) => Promise<{ data: BrandImageForClassification[] | null; error: unknown }>;
};

type BrandImagesUpdateQuery = {
  eq: (column: string, value: string) => BrandImagesUpdateQuery;
  neq: (column: string, value: string) => BrandImagesUpdateQuery;
  not: (
    column: string,
    operator: string,
    value: unknown,
  ) => BrandImagesUpdateQuery;
  select: (
    columns: string,
  ) => Promise<{ data: Array<{ id: string }> | null; error: unknown }>;
  then: Promise<{ error: unknown }>["then"];
};

type BrandImagesTable = {
  select: (columns: string) => BrandImagesSelectQuery;
  update: (row: Record<string, unknown>) => BrandImagesUpdateQuery;
};

type ClassifyImagesClient = {
  from(table: "brand_images" | "submission_images"): BrandImagesTable;
};

function isImageClassificationTag(
  value: unknown,
): value is ImageClassificationTag {
  return typeof value === "string" && VALID_TAGS.has(value);
}

function isKeptImageTag(value: unknown): value is KeptImageTag {
  return typeof value === "string" && KEEP_TAGS.includes(value as KeptImageTag);
}

/**
 * A current keep tag, or the modern equivalent of a legacy one. Returns null for
 * anything that is not a keepable image.
 *
 * This is the single place the four-tag vocabulary is collapsed into two, and it
 * runs on both read paths (stored rows and model responses) so a pre-collapse
 * `lifestyle`/`packaging` row keeps parsing as a valid kept image instead of
 * quietly becoming hero-ineligible.
 */
function keptImageTag(value: unknown): KeptImageTag | null {
  if (isKeptImageTag(value)) return value;
  if (typeof value !== "string") return null;
  return LEGACY_KEEP_TAG_ALIASES[value] ?? null;
}

function isImageRejectionReason(value: unknown): value is ImageRejectionReason {
  return (
    typeof value === "string" &&
    REJECTION_REASONS.includes(value as ImageRejectionReason)
  );
}

function scoreValue(value: BrandImageRow["score"]): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

export function isExemptSource(
  source: BrandImageRow["source"] | string | null,
): boolean {
  return typeof source === "string" && EXEMPT_SOURCES.has(source);
}

/**
 * A stored row as the ranker sees it. Exported because the orchestrator rebuilds
 * the products image pool from `getActiveImages` when acquire was satisfied from
 * history and produced no pool of its own — re-deriving the normalization here
 * would be a second copy of the legacy-tag rules.
 */
export function classifiedImageFromRow(
  row: BrandImageForClassification,
): ClassifiedImage | null {
  if (isExemptSource(row.source)) return null;

  const storedTag = row.tags?.find(isImageClassificationTag);
  if (!storedTag) return null;

  // Legacy `lifestyle`/`packaging` rows normalize to `product` here so the rest
  // of the pipeline only ever sees the current two-tag vocabulary.
  const tag: ImageClassificationTag = keptImageTag(storedTag) ?? storedTag;

  return {
    id: row.id,
    tag,
    score: scoreValue(row.score),
    storage_path: row.storage_path,
    width: row.width ?? null,
    height: row.height ?? null,
    // From the whole `tags` array, not from `storedTag` above: `storedTag` is
    // the first classification tag, while the renderer asks whether `logo` is
    // present at all. Reading the array here is what keeps ranking and
    // rendering answering the same question.
    isLogo: isLogoImageTags(row.tags),
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    ...(row.url ? { imageUrl: row.url } : {}),
    disposition: JUNK_TAGS.has(storedTag) ? "reject" : "keep",
    ...(storedTag === "promo"
      ? { rejectionReasons: ["promo_subject" as const] }
      : {}),
    ...(storedTag === "text_banner"
      ? { rejectionReasons: ["text_dominant" as const] }
      : {}),
    ...(storedTag === "irrelevant"
      ? { rejectionReasons: ["irrelevant" as const] }
      : {}),
  };
}

function extractArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const values = Object.values(obj);
    const arr = values.find(Array.isArray);
    if (arr) return arr;
    if ("tag" in obj) return [raw];
  }
  return null;
}

/**
 * Verdicts keyed by the ordinal the model was told to echo back in `id`.
 * Positional zipping is deliberately NOT used: a short or reordered array would
 * otherwise hand every later image the previous image's verdict.
 */
export function parseClassificationBatch(
  responseText: string,
): Map<string, ParsedImageClassification> {
  type RawClassification = {
    id?: unknown;
    disposition?: unknown;
    tag?: unknown;
    reasons?: unknown;
    score?: unknown;
    caption?: unknown;
  };

  const verdicts = new Map<string, ParsedImageClassification>();

  // Try structured parse with Zod first; fall back to extractArray for legacy
  // formats (bare arrays, single-object responses).
  const structuredResult = parseAndValidate(
    responseText,
    imageClassificationShape,
  );
  let items: RawClassification[] | null;
  if (structuredResult.success) {
    items = structuredResult.data
      .classifications as unknown as RawClassification[];
  } else {
    let raw: unknown;
    try {
      raw = JSON.parse(responseText);
    } catch {
      return verdicts;
    }
    items = extractArray(raw) as RawClassification[] | null;
  }
  if (!items) return verdicts;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    const id =
      typeof item.id === "string"
        ? item.id.trim()
        : typeof item.id === "number" && Number.isFinite(item.id)
          ? String(item.id)
          : "";
    if (!id || verdicts.has(id)) continue;
    const score =
      typeof item.score === "number" ? item.score : Number(item.score);
    if (!Number.isFinite(score)) continue;

    // Legacy tags (`lifestyle`, `packaging`) normalize onto `product` rather than
    // failing the narrowed keep check, which would drop the verdict entirely.
    const normalizedTag = keptImageTag(item.tag);

    const disposition =
      item.disposition === "keep" || item.disposition === "reject"
        ? item.disposition
        : JUNK_TAGS.has(item.tag as string)
          ? "reject"
          : normalizedTag
            ? "keep"
            : null;
    if (!disposition) continue;

    const tag = disposition === "keep" ? normalizedTag : null;
    if (disposition === "keep" && !tag) continue;

    const parsedReasons = Array.isArray(item.reasons)
      ? [...new Set(item.reasons.filter(isImageRejectionReason))]
      : [];
    const legacyReasons: ImageRejectionReason[] =
      item.tag === "promo"
        ? ["promo_subject"]
        : item.tag === "text_banner"
          ? ["text_dominant"]
          : item.tag === "irrelevant"
            ? ["irrelevant"]
            : [];

    const reasons = parsedReasons.length > 0 ? parsedReasons : legacyReasons;
    if (disposition === "keep" && reasons.length > 0) continue;
    if (disposition === "reject" && reasons.length === 0) continue;

    // The quality floor lives here rather than in the prompt: the model returns a
    // score either way, so the threshold can be swept against scores already in
    // the database without spending a single API call, and moving it is a code
    // change rather than a prompt revision that invalidates the eval baseline.
    const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
    const belowFloor = disposition === "keep" && clampedScore < MIN_KEEP_SCORE;

    verdicts.set(id, {
      disposition: belowFloor ? "reject" : disposition,
      tag: belowFloor ? null : tag,
      reasons: belowFloor ? ["low_visual_quality"] : reasons,
      score: clampedScore,
      caption: disposition === "keep" && !belowFloor
        ? (typeof item.caption === "string" && item.caption.trim().length > 0 ? item.caption.trim() : null)
        : null,
    });
  }

  return verdicts;
}

/**
 * Full weight of the crop-damage term, in score points.
 *
 * Calibrated so this replacement lands on top of the flat penalties it retires
 * rather than silently reshuffling every hero in the catalogue:
 *   - exact 4/3 (1200x900)  -> damage 0.000 -> 0.0 points
 *   - square  (1000x1000)   -> damage 0.250 -> 4.5 points
 *   - 2.39:1  (1600x670)    -> damage 0.442 -> 10.3 points, within a point of
 *     the deleted flat WIDE_ASPECT_PENALTY of 10
 *   - 2:3 portrait (800x1200) -> damage 0.500 -> 12.0 points (the cap)
 *
 * Exported so tests assert against the constant rather than a literal: raising
 * this must fail CI, not quietly promote junk past a good image.
 *
 * GATE C1 — stored dimensions validated against the actual image bytes
 * (2026-08-08). 60 active `brand_images` rows, sampled evenly across the full
 * aspect-ratio range, were re-probed with `sharp` against the bytes in Storage:
 * 0 mismatches at a 2% aspect-ratio drift tolerance.
 *
 * Recorded here because it is the blocking gate that this entire term rests on,
 * and because a passed gate leaves no trace in the code otherwise. `cropDamage`
 * is computed purely from the stored `width`/`height` columns, so a
 * systematically wrong aspect ratio would produce a confidently wrong damage
 * value — and the re-sort PREVIEW could not reveal it, because the preview is
 * computed from the same wrong number. There is no self-check available here;
 * the only way to know is to measure the bytes, which is what C1 did. Re-run it
 * if the download pipeline ever changes what it writes into those columns.
 */
export const CROP_DAMAGE_WEIGHT = 12;

// cropDamagePenalty, heroQuality, isPortrait and their private constants
// moved to ./image-ranking.ts — imported as `rank` for the ordering and
// `heroQualityForAspect` / `cropDamagePenaltyForAspect` for the resort plan.

/**
 * Applies the model's verdicts and produces the hero ordering.
 *
 * RE-BASELINE NOTE for any pipeline A/B harness that consumes this function to
 * compare variants: baselines stored before the crop-damage ranking term
 * (`heroQuality` above) will show an ordering shift on almost every brand.
 * That shift is the intended behaviour, not a regression — re-baseline before
 * reading the comparison. Left here because this is where the ordering is
 * decided, and the next operator will be reading this file.
 */
export function applyClassifications(images: ClassifiedImage[]): {
  rejectedIds: string[];
  rejectedUpdates: Array<{
    id: string;
    row: {
      status: "rejected";
      storage_path: string | null;
      tags: null;
      rejection_reasons?: ImageRejectionReason[] | null;
    };
  }>;
  ordered: ClassifiedImage[];
} {
  const rejected = images.filter(
    (image) => image.disposition === "reject" || JUNK_TAGS.has(image.tag),
  );
  const rejectedIds = rejected.map((image) => image.id);
  const rejectedUpdates = rejected.map((image) => ({
    id: image.id,
    row: {
      status: "rejected" as const,
      storage_path: image.storage_path ?? null,
      tags: null,
      ...(image.rejectionReasons
        ? { rejection_reasons: image.rejectionReasons }
        : {}),
    },
  }));
  const ordered = rank(images, HERO_TARGET_RATIO);

  return { rejectedIds, rejectedUpdates, ordered };
}

export type ActiveImageForOrdering = {
  id: string;
  source?: string | null;
  sort_order?: number | null;
  tags?: readonly string[] | null;
};

/**
 * Decides the final sort_order of every active image, and which ones have to
 * step down to stay inside the MAX_ACTIVE_IMAGES window.
 *
 * Exists because the reindex used to walk only *judged* images. An image the
 * vision model returned no verdict for is deliberately left active, but it was
 * then skipped here and kept the column default of 0 — so a submission could
 * end up with ten active rows all claiming to be the hero, which the app reads
 * as "has a hero" and the database rejects as "not exactly one".
 *
 * Judged images keep the classifier's ranking; unjudged ones are appended after
 * them, never ahead, so an unranked image cannot displace a scored product shot
 * as the hero. Human picks are never reordered or demoted — their positions are
 * reserved and merely counted against the cap.
 */
export function planActiveImageOrder(input: {
  activeImages: ActiveImageForOrdering[];
  rankedJudgedIds: string[];
}): {
  assignments: Array<{ id: string; sortOrder: number }>;
  candidateIds: string[];
  demotedIds: string[];
} {
  const { activeImages, rankedJudgedIds } = input;

  const exempt = activeImages.filter((row) => isExemptSource(row.source));
  const managed = activeImages.filter((row) => !isExemptSource(row.source));

  const rankIndex = new Map(rankedJudgedIds.map((id, index) => [id, index]));
  const judged = managed
    .filter((row) => rankIndex.has(row.id))
    .toSorted(
      (left, right) => rankIndex.get(left.id)! - rankIndex.get(right.id)!,
    );
  // Unjudged rows keep their incoming order (getActiveImages sorts by
  // sort_order) so repeated runs do not shuffle the gallery for no reason.
  const unjudged = managed.filter((row) => !rankIndex.has(row.id));

  const ranked = [...judged, ...unjudged];
  const capacity = Math.max(0, MAX_ACTIVE_IMAGES - exempt.length);
  const keep = ranked.slice(0, capacity);
  const demotedIds = ranked.slice(capacity).map((row) => row.id);

  // Product-first ordering: within the kept set, products lead, then at most
  // one logo. A logo-only brand keeps all its logos — the single-logo cap
  // applies only when product images exist, so a brand whose images are all
  // logos is not stripped down to one.
  const products = keep.filter((row) => !isLogoImageTags(row.tags));
  const logos = keep.filter((row) => isLogoImageTags(row.tags));
  const hasProducts = products.length > 0;
  const activeOrder = hasProducts
    ? [...products, ...logos.slice(0, 1)]
    : logos;
  const logoOverflow = hasProducts ? logos.slice(1) : [];

  const reserved = new Set(
    exempt.flatMap((row) =>
      typeof row.sort_order === "number" ? [row.sort_order] : [],
    ),
  );

  const assignments: Array<{ id: string; sortOrder: number }> = [];
  let sortOrder = 0;
  for (const row of activeOrder) {
    while (reserved.has(sortOrder)) sortOrder += 1;
    assignments.push({ id: row.id, sortOrder });
    sortOrder += 1;
  }

  // Excess logos are still valid candidates, but cannot remain active outside
  // the database's publishable sort_order window.
  const candidateIds = logoOverflow.map((row) => row.id);

  return { assignments, candidateIds, demotedIds };
}

/**
 * Builds the one ordering plan shared by the live classifier and the re-sort
 * review. Resort mode refuses before `applyClassifications` can produce a
 * destructive status update: its contract is an ordering-only, lossless pass.
 */
export function planHeroResort(input: {
  activeImages: BrandImageForClassification[];
  mode: "classify" | "resort";
}): HeroResortPlan {
  const { activeImages, mode } = input;
  const managedRows = activeImages.filter((row) => !isExemptSource(row.source));

  if (mode === "resort") {
    if (
      activeImages.some((row) =>
        (row.tags ?? []).some((tag) => JUNK_TAGS.has(tag)),
      )
    ) {
      return {
        assignments: [],
        candidateIds: [],
        demotedIds: [],
        rejectedUpdates: [],
        ranked: [],
        skipReason: "junk_tagged_active",
      };
    }
    if (activeImages.length > MAX_ACTIVE_IMAGES) {
      return {
        assignments: [],
        candidateIds: [],
        demotedIds: [],
        rejectedUpdates: [],
        ranked: [],
        skipReason: "over_capacity",
      };
    }
  }

  const classified = activeImages
    .map(classifiedImageFromRow)
    .filter((image): image is ClassifiedImage => image !== null);
  const applied = applyClassifications(classified);
  const rejectedIdSet = new Set(applied.rejectedIds);
  const ordering = planActiveImageOrder({
    activeImages: activeImages.filter((row) => !rejectedIdSet.has(row.id)),
    rankedJudgedIds: applied.ordered.map((image) => image.id),
  });

  const result: HeroResortPlan = {
    assignments: ordering.assignments,
    candidateIds: ordering.candidateIds,
    demotedIds: ordering.demotedIds,
    rejectedUpdates: applied.rejectedUpdates,
    ranked: applied.ordered.map((image) => ({
      id: image.id,
      score: image.score,
      cropDamage: cropDamagePenaltyForAspect(image, HERO_TARGET_RATIO),
      heroQuality: heroQualityForAspect(image, HERO_TARGET_RATIO),
    })),
    skipReason:
      mode === "resort" &&
      (managedRows.length === 0 || applied.ordered.length === 0)
        ? "no_managed_images"
        : null,
  };

  if (mode === "resort") {
    if (result.candidateIds.length > 0) {
      throw new Error(
        "resort mode produced candidateIds; ordering-only plan violated",
      );
    }
    if (result.demotedIds.length > 0) {
      throw new Error(
        "resort mode produced demotedIds; ordering-only plan violated",
      );
    }
    if (result.skipReason === "no_managed_images") {
      result.assignments = [];
    }
  }
  return result;
}

function classifyImagesClient(supabase: unknown): ClassifyImagesClient {
  return supabase as ClassifyImagesClient;
}

/**
 * Rows this run may classify: automated images that carry no verdict yet.
 *
 * `onlyImageIds` narrows that set to a named batch — the acquisition agent's
 * recovery pass classifies the images it has just downloaded, not everything
 * the brand has ever accumulated. An EMPTY array is honoured as "none", never
 * widened back to "all": the caller that passes an empty batch means it, and
 * silently classifying the whole brand instead is the expensive direction.
 */
async function getUnclassifiedImages(
  supabase: unknown,
  target: EnrichmentTarget,
  onlyImageIds?: readonly string[],
): Promise<BrandImageForClassification[]> {
  const storage = targetImageStorage(target);
  let query = classifyImagesClient(supabase)
    .from(storage.table)
    .select(
      "id, url, source, status, tags, score, sort_order, storage_path, source_url, width, height",
    )
    .eq(storage.foreignKey, target.id);

  if (onlyImageIds) {
    query = query.in("id", [...onlyImageIds]);
  }

  const { data, error } = await query
    .in("status", ["active", "candidate"])
    .neq("source", "owner")
    .neq("source", "admin")
    .is("tags", null)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getActiveImages(
  supabase: unknown,
  target: EnrichmentTarget,
): Promise<BrandImageForClassification[]> {
  const storage = targetImageStorage(target);
  const { data, error } = await classifyImagesClient(supabase)
    .from(storage.table)
    .select(
      "id, url, source, status, tags, score, sort_order, storage_path, source_url, width, height",
    )
    .eq(storage.foreignKey, target.id)
    .eq("status", "active")
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

async function updateImage(
  supabase: unknown,
  target: EnrichmentTarget,
  imageId: string,
  row: Record<string, unknown>,
): Promise<void> {
  const storage = targetImageStorage(target);
  const { error } = await classifyImagesClient(supabase)
    .from(storage.table)
    .update(row)
    .eq("id", imageId);

  if (error) throw error;
}

async function resetImageTags(
  supabase: unknown,
  target: EnrichmentTarget,
): Promise<number> {
  const storage = targetImageStorage(target);
  const { data, error } = await classifyImagesClient(supabase)
    .from(storage.table)
    .update({
      tags: null,
      score: null,
      rejection_reasons: null,
      rejected_at: null,
    })
    .eq(storage.foreignKey, target.id)
    .eq("status", "active")
    .neq("source", "owner")
    .neq("source", "admin")
    .not("tags", "is", null)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Any reason the response cannot be trusted to describe the images we sent.
 * A non-null reason means the batch is abandoned untouched — never converted into
 * verdicts, because a null verdict used to be indistinguishable from a junk verdict
 * and deleted live images on transient API errors.
 */
/**
 * Why the batch is untrustworthy, split by WHO failed.
 *
 * `provider` means the call reached OpenAI and OpenAI failed it. `storage` means
 * it never left our side, because Supabase Storage would not hand over the bytes
 * (DEV-1374). `content` means the model answered and the answer was unusable — a
 * refusal, a truncation, an empty body.
 *
 * `content` may not fail a target at all: before the split, a quota-exhausted
 * account and a model that refused one batch of images were both just "failed
 * batches", and the phase reported `succeeded` for both (2026-08-02, 407 falsely
 * -green targets). `provider` and `storage` both fail it, but they must never be
 * conflated: `provider` sets `providerFailure`, which feeds Gate C and the LLM
 * circuit breaker — three consecutive trips cancel every unstarted target in the
 * job and page the operator for an OpenAI outage. Storage was briefly reported
 * as `provider`, so one Supabase incident would have cancelled a whole run under
 * a diagnosis that named the wrong vendor.
 */
type BatchFailureKind = "provider" | "storage" | "content";

export type BatchFailure = {
  reason: string;
  kind: BatchFailureKind;
};

/**
 * Marks a phase failure as OURS, so the readers deciding who to page can tell it
 * apart from a vendor outage. Deliberately a message prefix, matching Gate A's
 * `PROVIDER_FAILURE_PREFIX` and Gate C's `LLM_PROVIDER_FAILURE_PREFIX`:
 * `curation_job_targets.phase_results` round-trips `error` through the database
 * already, so the attribution survives the worker/Next split and is still
 * readable on a row pulled up days later.
 *
 * Neither `isProviderFailureMessage` nor `isLlmProviderFailureMessage` matches
 * this prefix, which is the point — a storage outage must not be counted as a
 * provider failure nor fed to the LLM circuit breaker.
 */
export const STORAGE_FAILURE_PREFIX = "Storage unavailable";

export function failureReason(response: OpenAIChatResult): BatchFailure | null {
  if (!response.ok) {
    return {
      reason: `request failed (HTTP ${response.status})`,
      kind: "provider",
    };
  }
  if (response.refusal) {
    return { reason: `model refused: ${response.refusal}`, kind: "content" };
  }
  if (response.finishReason === "length") {
    return {
      reason: "response truncated (finish_reason=length)",
      kind: "content",
    };
  }
  if (!response.content || response.content.trim().length === 0) {
    return { reason: "empty response content", kind: "content" };
  }
  return null;
}

export type ChunkOutcome = {
  /** Verdicts keyed by brand_images.id, only for images the model actually judged. */
  verdictsByImageId: Map<string, ParsedImageClassification>;
  /** Non-null when the whole batch must be abandoned without touching any row. */
  failure: BatchFailure | null;
  /** Images whose bytes Storage would not give up — counted, never written to. */
  unavailableIds: string[];
};

type LoadedVisionImage = {
  image: BrandImageForClassification;
  dataUri: string;
};

export type PartitionedLoadedImages = {
  /** Images whose bytes we hold, in the order they will be numbered for the model. */
  sendable: LoadedVisionImage[];
  unavailableIds: string[];
  /** Non-null when nothing is left to send, so the call must not be made at all. */
  failure: BatchFailure | null;
};

/**
 * Split a chunk by whether we managed to read its bytes.
 *
 * One image we cannot load must not cost the chunk its verdicts — the property
 * the old drop-and-retry loop existed to protect, now enforced before the call
 * rather than by re-issuing it. The unavailable rows are simply left alone:
 * `tags` stays null and `status` stays active/candidate, which is exactly what
 * `getUnclassifiedImages` selects, so the next run re-queues them.
 *
 * When NOTHING loaded the failure is `storage`, not `content`: the request never
 * reached the model, so the absence of verdicts says nothing about the images,
 * and the phase must fail the target rather than report a green run that
 * classified zero images. Not `provider` either — that kind is what feeds the
 * LLM circuit breaker, and a Supabase outage must not cancel a job's remaining
 * targets under an OpenAI diagnosis.
 *
 * Exported for test: this is the invariant "our own infrastructure failing must
 * never write a permanent verdict", which is what DEV-1255 got wrong.
 */
export function partitionLoadedImages(
  chunk: readonly BrandImageForClassification[],
  loaded: readonly (string | null)[],
): PartitionedLoadedImages {
  const sendable: LoadedVisionImage[] = [];
  const unavailableIds: string[] = [];

  chunk.forEach((image, index) => {
    const dataUri = loaded[index];
    if (dataUri) {
      sendable.push({ image, dataUri });
    } else {
      unavailableIds.push(image.id);
    }
  });

  if (sendable.length === 0 && chunk.length > 0) {
    return {
      sendable,
      unavailableIds,
      failure: {
        reason: `could not load any of ${chunk.length} image(s) from storage`,
        kind: "storage",
      },
    };
  }

  return { sendable, unavailableIds, failure: null };
}

/**
 * Just the `chat` seam of the profiled client, so a caller can pass a stand-in
 * without reconstructing an audited OpenAI client. Narrowing to `Pick` rather
 * than widening to a hand-written signature keeps the input and output types
 * pinned to the real client — a drift in either is a build failure here.
 */
export type ClassifyImagesChatClient = Pick<
  ReturnType<typeof createProfiledOpenAIClient>,
  "chat"
>;

/** The bytes-loading seam. Production is `loadVisionDataUri`; tests inject. */
export type VisionImageLoader = (
  image: BrandImageForClassification,
) => Promise<string | null>;

async function classifyChunk(
  client: ClassifyImagesChatClient,
  brandContext: string,
  chunk: BrandImageForClassification[],
  loadImage: VisionImageLoader = loadVisionDataUri,
): Promise<ChunkOutcome> {
  const loaded = await mapWithConcurrency(
    chunk,
    VISION_LOAD_CONCURRENCY,
    (image) => loadImage(image),
  );
  const {
    sendable,
    unavailableIds,
    failure: loadFailure,
  } = partitionLoadedImages(chunk, loaded);

  if (loadFailure) {
    return {
      verdictsByImageId: new Map(),
      failure: loadFailure,
      unavailableIds,
    };
  }

  const imageByOrdinal = new Map(
    sendable.map(({ image }, index): [string, BrandImageForClassification] => [
      String(index + 1),
      image,
    ]),
  );
  const ordinals = [...imageByOrdinal.keys()];

  const classifySystemPrompt = await fetchLangfusePrompt("classify-images", IMAGE_CLASSIFY_SYSTEM_PROMPT);
  const userMessage = `${brandContext}Classify the ${sendable.length} brand images that follow, numbered ${ordinals.join(", ")} in order. Return a JSON object with a "classifications" array holding exactly ${sendable.length} objects, whose "id" values are the image numbers as strings. Do not omit any image.`;
  const chatParams = {
    system: classifySystemPrompt,
    user: userMessage,
    images: sendable.map(({ dataUri }) => dataUri),
    imageDetail: CLASSIFY_IMAGE_DETAIL,
    json: true,
    schema: IMAGE_CLASSIFICATION_SCHEMA,
    // The only per-call token budget in the pipeline: 350 per image in the
    // batch (raised from 250 for the caption field), so the profile cannot
    // know it statically.
    ...profileChatParams("classifyImages", {
      maxTokens: 350 * sendable.length,
      // Call-site, deliberately NOT in the llm-models profile: the profile is
      // also read by `buildProfiledEnrichmentConfig`, which persists it as the
      // audit contract in brand_ai_results.config, and a transport timeout is
      // not part of that contract. The 30s default was sized for a ~1KB body of
      // URLs that OpenAI then fetched itself; inlined base64 makes the body
      // ~400-500KB, which we have to finish uploading before the clock helps.
      timeoutMs: 120_000,
    }),
    meta: {
      imageIds: sendable.map(({ image }) => image.id),
      // INVARIANT: canonical brand_images.url, never the data URIs we actually
      // sent. `scripts/curate-brands.ts` zips this by index against the
      // classifications to key golden-set labels by URL, and base64 here would
      // also dump megabytes into every audit row.
      imageUrls: sendable.map(({ image }) => image.url),
    },
  };
  const response = await client.chat(chatParams);

  const failure = failureReason(response);
  if (failure) {
    return { verdictsByImageId: new Map(), failure, unavailableIds };
  }

  let effectiveContent = response.content ?? "";

  // 1-retry: on validation failure, retry the chunk once with structured feedback
  const validationCheck = parseAndValidate(
    effectiveContent,
    imageClassificationShape,
  );
  if (!validationCheck.success) {
    const retryInstruction = validationCheck.issues
      ? formatRetryInstruction(validationCheck.issues)
      : validationCheck.error;
    const retryResponse = await client.chat({
      ...chatParams,
      user: `${userMessage}\n\n${retryInstruction}`,
    });
    if (!failureReason(retryResponse) && retryResponse.content) {
      effectiveContent = retryResponse.content;
    }
  }

  const parsed = parseClassificationBatch(effectiveContent);
  const verdictsByImageId = new Map<string, ParsedImageClassification>();
  for (const [ordinal, image] of imageByOrdinal) {
    const verdict = parsed.get(ordinal);
    if (verdict) verdictsByImageId.set(image.id, verdict);
  }

  return { verdictsByImageId, failure: null, unavailableIds };
}

/**
 * One row write the classifier is allowed to perform, decided but not applied.
 * `classifyStoredImages` returns these; `applyPlannedImageWrites` performs them.
 */
export type PlannedImageWrite = {
  id: string;
  row: Record<string, unknown>;
};

type ChunkImageWrite = PlannedImageWrite;

export type ChunkWritePlan = {
  /** Every row write this chunk is allowed to perform, and no other. */
  writes: ChunkImageWrite[];
  classifications: ClassifiedImage[];
  rejectedCount: number;
  unjudgedCount: number;
};

/**
 * Turn one chunk's outcome into the exact set of row writes it may perform.
 *
 * A seam, not decoration. The write decision used to sit inline in the phase
 * loop, where the only thing between an image we could not load and a permanent
 * `status:'rejected'` + `rejection_reasons:['low_visual_quality']` was a bare
 * `continue` — untestable without a live supabase client, which the repo's
 * test-boundary rule forbids mocking. DEV-1255 destroyed 18 brand images through
 * exactly that write, and the 7-day retention purge made it irreversible.
 *
 * Pure, so a test can assert the property that actually matters: for an image
 * whose bytes we never got, the returned plan contains NO write at all — not a
 * softer one. Unjudged images get the same treatment for the same reason.
 */
export function planChunkImageWrites(input: {
  chunk: readonly BrandImageForClassification[];
  verdictsByImageId: ReadonlyMap<string, ParsedImageClassification>;
  unavailableIds: readonly string[];
  /** Passed in rather than read from the clock so the plan stays reproducible. */
  now: string;
  /**
   * The enclosing phase span, REQUIRED. Vocabulary is reported from the plan
   * rather than from the parse so the audit describes text that is actually
   * stored: a batch of ten images whose three failed to load still yields ten
   * parsed verdicts, and those three are written nowhere.
   */
  ctx: AuditCallContext;
}): ChunkWritePlan {
  const unavailable = new Set(input.unavailableIds);
  const writes: ChunkImageWrite[] = [];
  const classifications: ClassifiedImage[] = [];
  let rejectedCount = 0;
  let unjudgedCount = 0;

  for (const image of input.chunk) {
    // Images we could not read out of Storage. Deliberately NO row write: tags
    // stay null and status stays active/candidate, which is the predicate
    // getUnclassifiedImages selects, so the next run simply retries them.
    if (unavailable.has(image.id)) continue;

    const classification = input.verdictsByImageId.get(image.id);
    if (!classification) {
      // No verdict echoed for this image — leave the row alone, never reject it.
      unjudgedCount += 1;
      continue;
    }

    classifications.push({
      id: image.id,
      tag: classification.tag ?? "irrelevant",
      score: classification.score,
      storage_path: image.storage_path,
      width: image.width ?? null,
      height: image.height ?? null,
      // Mirrors the `tags` value written for this row a few lines below, so
      // ranking sees exactly the array the renderer will later read back.
      isLogo: isLogoImageTags(
        classification.tag === null ? null : [classification.tag],
      ),
      disposition: classification.disposition,
      rejectionReasons: classification.reasons,
      // Only when the row has one: an always-present `sourceUrl: null` would
      // change every existing classification literal these plans are compared
      // against, for a field that says nothing.
      ...(image.source_url ? { sourceUrl: image.source_url } : {}),
      // The image's own url, so a proposal ranked out of an acquire-built pool
      // can be fetched for bytes. Without it `rankForProduct(...)?.imageUrl` is
      // undefined for every image this run classified.
      ...(image.url ? { imageUrl: image.url } : {}),
    });

    const rejected = classification.disposition === "reject";
    if (rejected) rejectedCount += 1;
    writes.push({
      id: image.id,
      row: {
        tags: rejected ? null : [classification.tag as KeptImageTag],
        score: classification.score,
        status: rejected ? "rejected" : "active",
        rejection_reasons: rejected ? classification.reasons : null,
        rejected_at: rejected ? input.now : null,
        alt_zh: classification.caption ?? null,
      },
    });
  }

  return { writes, classifications, rejectedCount, unjudgedCount };
}

/**
 * Identifying context sent with every classification batch.
 *
 * The name alone is not enough to answer "is this the right brand?". Marketplace
 * listings (Pinkoi, Shopee, momo) carry the seller's storefront rather than a
 * visible logo, so a model given only a name it does not recognise has nothing
 * to check against — and measured over three identical runs it resolved that
 * uncertainty differently each time, once rejecting an entire ten-image batch as
 * wrong_brand and twice keeping all ten. The official domain gives it something
 * verifiable.
 *
 * English, matching the system prompt. An offline harness must build the same
 * context so it measures what production actually sends; the corpus manifest
 * carries no website, so it passes `website: null` until the next capture.
 */
/**
 * `pinkoi.com/store/<slug>` — including the hk./cn. locale hosts and Pinkoi's
 * long tracking query — identifies the seller as precisely as a domain does. A
 * brand with no site of its own but a storefront was previously sent name-only
 * context, which is the exact condition the doc comment above describes as
 * unstable: measured over the 2026-08-03 run, brands with no website drew a
 * 12.1% wrong_brand rate against 6.0% for brands with one.
 */
function pinkoiStoreSlug(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!/(^|\.)pinkoi\.com$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/\/store\/([^/]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Profile handle only. Post and reel permalinks (`/p/<id>`, `/reel/<id>`) carry
 * no identity — one affected brand had `instagram.com/p/DWd7Jm9k_xS/` stored as
 * its Instagram, and emitting "@p" would be worse than emitting nothing.
 */
function instagramHandle(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) return null;
    const segment = parsed.pathname.split("/").filter(Boolean)[0];
    if (!segment) return null;
    if (/^(p|reel|reels|explore|stories|tv)$/i.test(segment)) return null;
    return segment;
  } catch {
    return null;
  }
}

export function buildBrandContext(brand: {
  name: string | null;
  categorySlug: string | null;
  website: string | null;
  pinkoi?: string | null;
  instagram?: string | null;
}): string {
  const parts: string[] = [`Brand: ${brand.name ?? "unknown"}.`];

  const category = brand.categorySlug
    ? L1_CATEGORIES.find((c) => c.slug === brand.categorySlug)?.name
    : undefined;
  if (category) parts.push(`Category: ${category}.`);

  const host = (() => {
    const raw = brand.website?.trim();
    if (!raw) return null;
    try {
      return new URL(raw).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();
  if (host) parts.push(`Official site: ${host}.`);

  const storeSlug = pinkoiStoreSlug(brand.pinkoi);
  if (storeSlug) parts.push(`Pinkoi store: ${storeSlug}.`);

  const handle = instagramHandle(brand.instagram);
  if (handle) parts.push(`Instagram: @${handle}.`);

  // Stated so the model can tell "I was given nothing to check against" apart
  // from "I checked and it did not match" — the prompt's Step 3 withholds
  // wrong_brand on the former.
  if (!host && !storeSlug && !handle) {
    parts.push("No verified identifier available for this brand.");
  }

  return `${parts.join(" ")} `;
}

export type ClassifyStoredImagesOptions = {
  brand: EnrichBrand;
  target: EnrichmentTarget;
  dryRun?: boolean;
  /** Clear existing verdicts first, so already-judged rows are re-read. */
  overwrite?: boolean;
  jobId?: string;
  /**
   * Restrict the candidate rows to a named batch — the acquisition agent
   * classifies the images it has just downloaded, not the brand's whole
   * history. See `getUnclassifiedImages` for the empty-array rule.
   */
  onlyImageIds?: readonly string[];
  /** This run's pending patch, so the brand context uses links it just proposed. */
  pendingPatch?: EnrichPatch;
  /** Defaults to the service client. Callers holding one should pass it. */
  supabase?: unknown;
  /** Defaults to the profiled vision client. */
  client?: ClassifyImagesChatClient;
  /** Defaults to `loadVisionDataUri`. */
  loadImage?: VisionImageLoader;
  /**
   * The enclosing audit span, forwarded to `planChunkImageWrites`. A caller
   * outside an audited phase gets a throwaway rather than being forced to
   * fabricate one.
   */
  ctx?: AuditCallContext;
};

export type ClassifyStoredImagesResult = {
  classified: ClassifiedImage[];
  /** Every row write these verdicts justify — planned, never applied here. */
  writes: PlannedImageWrite[];
  rejectedCount: number;
  unjudgedCount: number;
  unavailableCount: number;
  /** Batches sent to the model. The denominator for "every batch failed". */
  attemptedBatches: number;
  failures: BatchFailure[];
  /** Unclassified rows read. The denominator for the keep rate. */
  candidateCount: number;
  /** Non-null when nothing was attempted, carrying the reason verbatim. */
  skipped: string | null;
};

function skippedClassifyResult(reason: string): ClassifyStoredImagesResult {
  return {
    classified: [],
    writes: [],
    rejectedCount: 0,
    unjudgedCount: 0,
    unavailableCount: 0,
    attemptedBatches: 0,
    failures: [],
    candidateCount: 0,
    skipped: reason,
  };
}

/**
 * Read a target's unclassified images, judge them, and return the row writes
 * those verdicts justify — WITHOUT performing any of them.
 *
 * This is `runClassifyImagesPhase` minus its writes, split out so the
 * acquisition agent can classify the images it has just stored without
 * re-entering the phase runner (which would re-read the whole brand, re-rank
 * every hero, and emit a second phase result for a phase that is not running).
 *
 * The write-free contract is the point. Returning a plan keeps the decision
 * ("this image is junk") separable from the destruction ("set status=rejected"),
 * which is the seam DEV-1255 lacked when it permanently destroyed 18 live brand
 * images on a transient storage failure. `applyPlannedImageWrites` is the only
 * thing that turns the plan into rows.
 *
 * One consequence worth naming: writes now land after ALL batches rather than
 * between them, so a mid-run crash writes nothing instead of writing a prefix.
 * That is the safer direction — every unwritten row keeps `tags: null` and is
 * simply re-queued by the next run.
 */
export async function classifyStoredImages(
  options: ClassifyStoredImagesOptions,
): Promise<ClassifyStoredImagesResult> {
  const {
    brand,
    target,
    dryRun = false,
    overwrite = false,
    jobId,
    onlyImageIds,
    pendingPatch,
    loadImage = loadVisionDataUri,
    ctx = { summary: {} },
  } = options;

  // Ahead of every read: a dry run must not touch Storage, the model, or the
  // image tables, so there is nothing to undo when it is over.
  if (dryRun) return skippedClassifyResult("dry run");

  const supabase = options.supabase ?? createServiceClient();

  if (overwrite) {
    const resetCount = await resetImageTags(supabase, target);
    if (resetCount > 0) {
      console.log(
        `  [CLASSIFY] Reset tags on ${resetCount} images for reclassification`,
      );
    }
  }

  const images = await getUnclassifiedImages(supabase, target, onlyImageIds);
  if (images.length === 0) {
    return skippedClassifyResult("no unclassified images");
  }

  const client =
    options.client ??
    createProfiledOpenAIClient("classifyImages", {
      target,
      phase: "classify_images",
      ...(jobId ? { jobId } : {}),
      // The model comes from the shared resolver, never a second literal: this
      // object is the stored audit contract, and a drifting copy makes every
      // brand_ai_results row for this phase record a model that never ran.
      config: buildProfiledEnrichmentConfig(
        "classify_images",
        IMAGE_CLASSIFY_SYSTEM_PROMPT,
        "classifyImages",
        {
          batchSize: IMAGE_CLASSIFY_BATCH_SIZE,
          detail: CLASSIFY_IMAGE_DETAIL,
        },
      ),
    });

  const classified: ClassifiedImage[] = [];
  const writes: PlannedImageWrite[] = [];
  const failures: BatchFailure[] = [];
  let attemptedBatches = 0;
  let unjudgedCount = 0;
  let unavailableCount = 0;
  let rejectedCount = 0;

  const brandContext = buildBrandContext({
    name: brand.name ?? brand.slug,
    categorySlug: brand.category ?? null,
    website: preferPatched(
      pendingPatch,
      brand.purchase_website,
      "purchase_website",
    ),
    pinkoi: preferPatched(pendingPatch, brand.purchase_pinkoi, "purchase_pinkoi"),
    instagram: preferPatched(
      pendingPatch,
      brand.social_instagram,
      "social_instagram",
    ),
  });

  for (let i = 0; i < images.length; i += IMAGE_CLASSIFY_BATCH_SIZE) {
    const chunk = images.slice(i, i + IMAGE_CLASSIFY_BATCH_SIZE);
    attemptedBatches += 1;
    const outcome = await classifyChunk(client, brandContext, chunk, loadImage);
    unavailableCount += new Set(outcome.unavailableIds).size;

    if (outcome.failure) {
      // Leave every remaining row untouched (tags stay null, status stays
      // active) so the next run retries them instead of destroying them.
      failures.push(outcome.failure);
      console.error(
        `  [CLASSIFY] Batch of ${chunk.length} images skipped for ${target.type} ${target.id}: ${outcome.failure.reason}`,
      );
      continue;
    }

    // Which rows may be written is decided in one pure place, so the
    // "unloadable image is never written to" invariant is testable rather
    // than resting on a `continue` inside an un-mockable loop (DEV-1255).
    const plan = planChunkImageWrites({
      chunk,
      verdictsByImageId: outcome.verdictsByImageId,
      unavailableIds: outcome.unavailableIds,
      now: new Date().toISOString(),
      ctx,
    });
    classified.push(...plan.classifications);
    writes.push(...plan.writes);
    rejectedCount += plan.rejectedCount;
    unjudgedCount += plan.unjudgedCount;
  }

  return {
    classified,
    writes,
    rejectedCount,
    unjudgedCount,
    unavailableCount,
    attemptedBatches,
    failures,
    candidateCount: images.length,
    skipped: null,
  };
}

/** Perform a plan from `classifyStoredImages`, one row at a time, in order. */
export async function applyPlannedImageWrites(
  supabase: unknown,
  target: EnrichmentTarget,
  writes: readonly PlannedImageWrite[],
): Promise<void> {
  for (const write of writes) {
    await updateImage(supabase, target, write.id, write.row);
  }
}

export type HeroOrderOutcome = {
  assignments: HeroResortPlan["assignments"];
  candidateIds: string[];
  demotedIds: string[];
  rejectedIds: string[];
  /**
   * First active row's storage key AFTER the reorder. Only read for submission
   * targets, whose patch carries the hero forward; brand targets denormalize
   * through `syncHeroDenormalized` instead.
   */
  heroStoragePath: string | null;
};

/**
 * Re-rank a target's active images and write the resulting order.
 *
 * Everything downstream of the verdicts: rejections the ranking decided,
 * `sort_order` for every row still active (including ones the model never
 * judged, so a human-chosen image keeps its reserved position), demotion past
 * the active-window cap, and the denormalized hero for brand targets.
 *
 * Overflow past the cap steps down to `rejected` but keeps its storage object:
 * those images ranked below the cap, they are not junk, and deleting them
 * would be irreversible.
 */
export async function finalizeHeroOrder(
  supabase: unknown,
  target: EnrichmentTarget,
  options: { mode: "classify" | "resort" },
): Promise<HeroOrderOutcome> {
  const activeImages = await getActiveImages(supabase, target);
  const plan = planHeroResort({ activeImages, mode: options.mode });
  const rejectedIds = plan.rejectedUpdates.map((update) => update.id);

  for (const update of plan.rejectedUpdates) {
    await updateImage(supabase, target, update.id, {
      ...update.row,
      rejected_at: new Date().toISOString(),
    });
  }

  for (const { id, sortOrder } of plan.assignments) {
    await updateImage(supabase, target, id, { sort_order: sortOrder });
  }

  for (const id of plan.candidateIds) {
    await updateImage(supabase, target, id, { status: "candidate" });
  }

  for (const id of plan.demotedIds) {
    await updateImage(supabase, target, id, { status: "rejected" });
  }

  if (target.type === "brand") {
    await syncHeroDenormalized(supabase, target.id);
  }

  const finalActiveImages =
    target.type === "submission" ? await getActiveImages(supabase, target) : [];

  return {
    assignments: plan.assignments,
    candidateIds: plan.candidateIds,
    demotedIds: plan.demotedIds,
    rejectedIds,
    heroStoragePath: finalActiveImages.at(0)?.storage_path ?? null,
  };
}

export async function runClassifyImagesPhase({
  brand,
  phases,
  dryRun = false,
  overwrite = false,
  target: requestedTarget,
  jobId,
  pendingPatch,
}: ClassifyImagesPhaseOptions): Promise<ClassifyImagesPhaseOutput> {
  if (!phases.includes("classify_images")) {
    return {
      phaseResult: buildPhaseResult(
        "classify_images",
        "skipped",
        [],
        0,
        undefined,
        "classify_images phase not requested",
      ),
      patch: {},
    };
  }

  if (dryRun) {
    return {
      phaseResult: buildPhaseResult(
        "classify_images",
        "skipped",
        [],
        0,
        undefined,
        "dry run",
      ),
      patch: {},
    };
  }

  return auditedCall(
    {
      provider: "enrich",
      operation: "runClassifyImagesPhase",
      kind: "service",
    },
    async (ctx) => {
      const target = requestedTarget ?? brandTarget(brand.id);
      const supabase = createServiceClient();

      // Judge first, write second. The two halves are separate functions so the
      // acquisition agent can reuse the judging one without the writes; the
      // phase is the caller that wants both.
      const { result, durationMs } = await timePhase(async () => {
        const judged = await classifyStoredImages({
          brand,
          target,
          overwrite,
          jobId,
          pendingPatch,
          supabase,
          ctx,
        });
        if (judged.skipped) return { judged, hero: null };

        await applyPlannedImageWrites(supabase, target, judged.writes);
        const hero = await finalizeHeroOrder(supabase, target, {
          mode: "classify",
        });
        return { judged, hero };
      });

      const { judged, hero } = result;
      if (judged.skipped || !hero) {
        return {
          phaseResult: buildPhaseResult(
            "classify_images",
            "skipped",
            [],
            0,
            undefined,
            judged.skipped ?? "no unclassified images",
          ),
          patch: {},
        };
      }

      const classifiedCount = judged.classified.length;
      const classifierKept = judged.classified.filter(
        (classification) => classification.disposition === "keep",
      ).length;
      // Rejections come from two places: the model's own verdicts, and the
      // ranking's overflow past the active-image window.
      const rejectedCount = judged.rejectedCount + hero.rejectedIds.length;

      const changedFields =
        classifiedCount > 0
          ? [target.type === "brand" ? "brand_images" : "submission_images"]
          : [];
      Object.assign(ctx.summary, {
        gatePassingImages: judged.candidateCount,
        classifierKept,
        classifierKeep:
          judged.candidateCount > 0
            ? classifierKept / judged.candidateCount
            : 0,
      });
      const patch =
        target.type === "submission" && classifiedCount > 0
          ? // DEV-1551: the bucket key, not a URL. `submissionToDomain` derives
            // the `/i/` form from it.
            { hero_image_storage_path: hero.heroStoragePath }
          : {};

      const detail = [
        `${classifiedCount} classified`,
        `${rejectedCount} rejected`,
        ...(judged.unjudgedCount > 0
          ? [`${judged.unjudgedCount} left unjudged`]
          : []),
        ...(judged.unavailableCount > 0
          ? [`${judged.unavailableCount} unavailable`]
          : []),
        ...(judged.failures.length > 0
          ? [
              `${judged.failures.length} batch(es) skipped: ${judged.failures
                .map((failure) => failure.reason)
                .join("; ")}`,
            ]
          : []),
      ].join(", ");

      // Nothing was judged: every batch we attempted died. `succeeded` with zero
      // classifications is what an admin then approved 103 times on 2026-08-02, so
      // the target has to fail — but only when the whole phase died. A run where one
      // batch was refused and another classified fine stays `succeeded`.
      const allBatchesFailed =
        judged.attemptedBatches > 0 &&
        judged.failures.length === judged.attemptedBatches;

      const allBatchesProviderFailed =
        allBatchesFailed &&
        judged.failures.every((failure) => failure.kind === "provider");

      // Same outcome, different culprit, and the difference is expensive: only
      // `providerFailure` feeds Gate C and the LLM circuit breaker, whose trip
      // cancels every unstarted target in the job and pages for an OpenAI outage. A
      // batch set that includes one of OUR storage failures is not evidence about
      // OpenAI, so it fails the target under its own name instead. Mixed with a
      // `content` failure it stays out of both branches, as before — the model
      // answered for at least one batch, so the phase is not wholly untrusted.
      const allBatchesStorageFailed =
        allBatchesFailed &&
        !allBatchesProviderFailed &&
        judged.failures.every(
          (failure) =>
            failure.kind === "storage" || failure.kind === "provider",
        );

      if (allBatchesStorageFailed) {
        return {
          phaseResult: buildPhaseResult(
            "classify_images",
            "failed",
            [],
            durationMs,
            `${STORAGE_FAILURE_PREFIX} — could not read the images for any of ${judged.attemptedBatches} batch(es) out of Storage`,
            detail,
          ),
          patch: {},
        };
      }

      if (allBatchesProviderFailed) {
        return {
          phaseResult: {
            ...buildPhaseResult(
              "classify_images",
              "failed",
              [],
              durationMs,
              `LLM provider failed all ${judged.attemptedBatches} image batch(es)`,
              detail,
            ),
            providerFailure: true,
          },
          patch: {},
        };
      }

      return {
        phaseResult: buildPhaseResult(
          "classify_images",
          "succeeded",
          changedFields,
          durationMs,
          undefined,
          detail,
        ),
        patch,
      };
    },
    {
      classify: (result) =>
        result.phaseResult.status === "failed"
          ? "failed"
          : result.phaseResult.status === "skipped"
            ? "empty"
            : "succeeded",
    },
  );
}
