import { cache } from "react";
import { unstable_cache } from "next/cache";
import { auditedCall } from "@/lib/audit";
import { pinyin } from "pinyin-pro";
import { convertPinyinToWadeGiles } from "@/lib/utils/pinyin-to-wade-giles";
import type { Brand, BrandFilters, OtherUrl } from "@/lib/types";
import type {
  ReputationSummary,
  SiteContent,
  SiteProduct,
  SiteTokens,
} from "@/lib/types/brand";
import type { Database } from "@/lib/supabase/database.types";
import { toBrandRow as baseToBrandRow } from "./_shared/field-map";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createServiceClient } from "@/lib/supabase/server";
import {
  canDegradeDuringPrerender,
  captureReadFailure,
} from "@/lib/degraded-render";
import { BRAND_SORT_CONFIG, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { isNonImageHost } from "@/lib/images/allowed-image-hosts";
import { RESERVED_ROUTES } from "@/proxy";
import {
  deriveCategoryFromProductType,
  matchSubcategory,
  PRODUCT_TYPE_CATEGORIES,
} from "@/lib/taxonomy/ontology";
import { slugifyRomanizedName, withSlugSuffix } from "@/lib/brands/slug";
import { downloadAndStoreImages } from "./image-download";
import { excludeTestBrands } from "./public-brand-filter";
import { PUBLIC_BRAND_DATA_TAG } from "@/lib/cache/public-brand-cache";
import {
  PURCHASE_CAMEL_FIELDS,
  PURCHASE_CHANNELS,
  PURCHASE_COLUMNS,
  purchaseChannelByKey,
  purchaseChannelByPlatformSlug,
  type PurchaseChannelCamelField,
  type PurchaseChannelColumn,
  type PurchaseChannelPlatformSlug,
} from "@/lib/brands/purchase-channels";
import {
  resolveWritablePatch,
  type BrandFieldWriteState,
  type BrandWriteActor,
  type SkippedBrandField,
} from "./brand-write-policy";
import {
  getBrandImages,
  insertBrandImage,
  syncHeroDenormalized,
  toImageFields,
} from "./brand-images";

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getDailySeed(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function shuffleArray<T>(arr: T[], seed?: number): void {
  const rng = seed != null ? mulberry32(seed) : Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type BrandRow = Database["public"]["Tables"]["brands"]["Row"];
type BrandDraftData = BrandRow["draft_data"];
type BrandFlatLinkColumns = {
  social_instagram?: string | null;
  social_threads?: string | null;
  social_facebook?: string | null;
  other_urls?: unknown;
} & {
  [Column in PurchaseChannelColumn]?: string | null;
};

export type CuratedSubmissionInput = {
  name: string;
  slug: string;
  description: string;
  category: string;
  productType?: string;
  heroImageUrl?: string | null;
  productPhotos: string[];
  purchaseLinks: Array<{ platform: string; url: string }>;
  socialLinks: {
    instagram: string;
    threads: string;
    facebook: string;
    website: string;
  };
  region?: string | null;
};

type CuratedBrand = Partial<Brand> &
  Pick<
    Brand,
    | "socialInstagram"
    | "socialThreads"
    | "socialFacebook"
    | "otherUrls"
    | "status"
    | "heroImageUrl"
    | "contactEmail"
    | "foundingYear"
  > &
  Pick<Brand, PurchaseChannelCamelField> & { productType: string };

export type BrandWriteInput = Partial<Brand> & { productType?: string | null };
type BrandWriteResult = Brand & { skipped: SkippedBrandField[] };
type ApplyBrandPatchArgs = {
  p_brand_id: string;
  p_patch: Record<string, unknown>;
  p_source: BrandWriteActor["source"];
  p_actor: string | null;
  p_job_id: string | null;
};
type BrandFieldStateRow = {
  field: string;
  source: string;
  updated_at: string;
};
type BrandFieldStateTable = {
  select: (columns: "field, source, updated_at") => {
    eq: (
      column: "brand_id",
      value: string,
    ) => Promise<{
      data: BrandFieldStateRow[] | null;
      error: { message?: string } | null;
    }>;
  };
};
type BrandPatchRpcClient = {
  rpc: (
    fn: "apply_brand_patch",
    args: ApplyBrandPatchArgs,
  ) => Promise<{
    error: { code?: string; message?: string } | null;
  }>;
};

/** Shape returned by: brand_owners(user_id) */
type BrandOwnerRef = { user_id: string };

/**
 * Full joined row from BRAND_SELECT. Extends Partial<BrandRow> so that
 * unit test fixtures can omit columns added in later migrations (is_demo,
 * price_range, product_tags) without a cast — the mapper uses
 * ?? defaults for all optional fields.
 */
export type BrandRowWithJoins = Partial<BrandRow> &
  BrandFlatLinkColumns & {
    price_range?: number | null;
    product_tags?: string[] | null;
    description_en?: string | null;
    blurb?: string | null;
    blurb_en?: string | null;
    product_tags_en?: string[] | null;
  } & Pick<
    BrandRow,
    | "id"
    | "name"
    | "slug"
    | "status"
    | "submitted_at"
    | "created_at"
    | "updated_at"
  > & {
    brand_owners?: BrandOwnerRef | BrandOwnerRef[] | null;
  };

export type SearchResult = {
  id: string;
  name: string;
  slug: string;
  category: string;
  rankScore: number;
  searchSource: string;
  /** @deprecated Use rankScore. Kept for existing autocomplete consumers. */
  similarity: number;
};

type SearchBrandsRow = {
  id: string;
  name: string;
  slug: string;
  hero_image_url: string | null;
  primary_category_name: string | null;
  rank_score: number;
  search_source: string;
};

type SearchBrandsResult = {
  data: SearchBrandsRow[] | null;
  error: { code?: string; message?: string } | null;
};

export type SearchBrandAutocompleteResult = {
  id: string;
  slug: string;
  name: string;
  category: string;
};

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

export function extractLatinRun(name: string): string | null {
  const runs = name
    .match(
      /[\p{Script=Latin}\p{Number}\p{Mark}]+(?:[\s&.'’\-]*[\p{Script=Latin}\p{Number}\p{Mark}]+)*/gu,
    )
    ?.map((run) => run.trim())
    .filter(Boolean);

  if (!runs?.length) {
    return null;
  }

  return runs.reduce((longest, run) =>
    run.length > longest.length ? run : longest,
  );
}

export function generateSlug(name: string): string {
  // Transliterate CJK characters to pinyin; non-CJK chars pass through unchanged
  const syllables = pinyin(name, {
    toneType: "none",
    type: "array",
    nonZh: "consecutive",
  });
  const transliterated = /\p{Script=Han}/u.test(name)
    ? convertPinyinToWadeGiles(syllables).join(" ")
    : syllables.join(" ");

  return transliterated
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const VALID_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function isValidSlug(slug: string): boolean {
  return VALID_SLUG_PATTERN.test(slug) && !slug.includes("--");
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_ROUTES.has(slug);
}

function getString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function parseJsonString(value: string, fieldName: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${fieldName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseMaybeJson(value: unknown, fieldName: string): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }

  return parseJsonString(trimmed, fieldName);
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  const parsedValue = parseMaybeJson(value, fieldName);

  if (Array.isArray(parsedValue)) {
    return parsedValue.map((item) => getString(item)).filter(Boolean);
  }

  const raw = getString(parsedValue);
  if (!raw) {
    return [];
  }

  return raw
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseBrandCSV(
  csvText: string,
): Record<string, string | string[]>[] {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      currentRow.push(currentCell);
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentCell = "";
      currentRow = [];
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    return [];
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((header) => header.trim());

  return dataRows.map((cells) => {
    const row: Record<string, string | string[]> = {};
    headers.forEach((header, index) => {
      const value = cells[index] ?? "";
      row[header] = value.includes("|")
        ? parseStringArray(value, header)
        : value;
    });
    return row;
  });
}

export function curatedSubmissionToBrand(
  input: CuratedSubmissionInput,
): CuratedBrand {
  const purchaseValues: Partial<
    Record<PurchaseChannelCamelField, string>
  > = {};
  const otherUrls: OtherUrl[] = [];
  for (const link of input.purchaseLinks) {
    const platform = link.platform.toLowerCase();
    const platformSlug =
      platform === "official"
        ? purchaseChannelByKey.website.platformSlug
        : platform;
    const channel = Object.hasOwn(purchaseChannelByPlatformSlug, platformSlug)
      ? purchaseChannelByPlatformSlug[
          platformSlug as PurchaseChannelPlatformSlug
        ]
      : undefined;

    if (!channel) {
      otherUrls.push({ label: link.platform, url: link.url });
      continue;
    }

    if (!(channel.camel in purchaseValues)) {
      purchaseValues[channel.camel] = link.url;
    }
  }

  const purchaseFields = Object.fromEntries(
    PURCHASE_CHANNELS.map((channel) => [
      channel.camel,
      channel === purchaseChannelByKey.website
        ? input.socialLinks.website || purchaseValues[channel.camel] || null
        : purchaseValues[channel.camel] ?? null,
    ]),
  ) as Pick<Brand, PurchaseChannelCamelField>;

  return {
    name: input.name,
    slug: input.slug,
    description: input.description,
    heroImageUrl: input.heroImageUrl || null,
    status: "approved",
    category: input.category,
    productType: input.productType ?? input.category,
    foundingYear: null,
    socialInstagram: input.socialLinks.instagram || null,
    socialThreads: input.socialLinks.threads || null,
    socialFacebook: input.socialLinks.facebook || null,
    ...purchaseFields,
    otherUrls,
    productPhotos: input.productPhotos,
    contactEmail: null,
  };
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

const BRAND_DRAFT_EDITABLE_KEYS = [
  "name",
  "romanizedName",
  "description",
  "productType",
  "foundingYear",
  "socialInstagram",
  "socialThreads",
  "socialFacebook",
  "heroImageUrl",
  "productPhotos",
  "priceRange",
  "productTags",
  ...PURCHASE_CAMEL_FIELDS,
  "mitStory",
  "otherUrls",
  "reputationSummary",
] as const satisfies readonly (keyof Brand)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeReputationSummary(value: unknown): ReputationSummary | null {
  if (!isRecord(value) || typeof value.text !== "string") return null;
  const sources = Array.isArray(value.sources)
    ? value.sources.flatMap((source) =>
        isRecord(source) && typeof source.url === "string" && source.url.trim()
          ? [{ url: source.url }]
          : [],
      )
    : [];
  const textEn =
    typeof value.text_en === "string" && value.text_en.trim().length > 0
      ? value.text_en.trim()
      : null;
  return { text: value.text, textEn, sources };
}

function normalizeSiteTokens(value: unknown): SiteTokens {
  const tokens = isRecord(value) ? value : {};
  const result: SiteTokens = {
    accent: typeof tokens.accent === "string" ? tokens.accent : "",
  };
  const accentForeground = optionalString(tokens.accentForeground);
  if (accentForeground !== undefined)
    result.accentForeground = accentForeground;
  return result;
}

function normalizeSiteProduct(value: unknown): SiteProduct | null {
  if (!isRecord(value)) return null;

  const result: SiteProduct = {
    name: typeof value.name === "string" ? value.name : "",
  };
  const imageUrl = optionalString(value.imageUrl);
  if (imageUrl !== undefined) result.imageUrl = imageUrl;
  const url = optionalString(value.url);
  if (url !== undefined) result.url = url;
  const caption = optionalString(value.caption);
  if (caption !== undefined) result.caption = caption;
  return result;
}

export function normalizeSiteContent(raw: unknown): SiteContent | null {
  if (!raw || !isRecord(raw) || Object.keys(raw).length === 0) return null;

  const result: SiteContent = {
    template: typeof raw.template === "string" ? raw.template : "default",
    tokens: normalizeSiteTokens(raw.tokens),
    products: Array.isArray(raw.products)
      ? raw.products.flatMap((product) => {
          const normalized = normalizeSiteProduct(product);
          return normalized ? [normalized] : [];
        })
      : [],
    ctaType: raw.ctaType === "mailto" ? raw.ctaType : "mailto",
  };

  const tagline = optionalString(raw.tagline);
  if (tagline !== undefined) result.tagline = tagline;
  const story = optionalString(raw.story);
  if (story !== undefined) result.story = story;
  const ctaValue = optionalString(raw.ctaValue);
  if (ctaValue !== undefined) result.ctaValue = ctaValue;

  return result;
}

function draftDataToSnapshot(
  value: BrandDraftData,
): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export const BRAND_DRAFT_PROGRESS_KEY = "__wizardCompletedSteps";

export function brandToDraftSnapshot(
  data: Partial<Brand>,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of BRAND_DRAFT_EDITABLE_KEYS) {
    if (key in data && data[key] !== undefined) {
      snapshot[key] = data[key];
    }
  }
  const progress = (data as Record<string, unknown>)[BRAND_DRAFT_PROGRESS_KEY];
  if (Array.isArray(progress)) {
    const normalized = progress.filter(
      (step): step is number => Number.isInteger(step) && step >= 0,
    );
    if (normalized.length > 0) {
      snapshot[BRAND_DRAFT_PROGRESS_KEY] = Array.from(new Set(normalized)).sort(
        (left, right) => left - right,
      );
    }
  }
  return snapshot;
}

export function draftSnapshotToDomain(
  snapshot: Record<string, unknown>,
  _base?: Brand,
): Partial<Brand> {
  void _base;
  const partial: Partial<Brand> = {};

  for (const key of BRAND_DRAFT_EDITABLE_KEYS) {
    if (!(key in snapshot)) continue;

    if (PURCHASE_CAMEL_FIELDS.includes(key as PurchaseChannelCamelField)) {
      const purchaseField = key as PurchaseChannelCamelField;
      (
        partial as Partial<Pick<Brand, PurchaseChannelCamelField>>
      )[purchaseField] = snapshot[purchaseField] as Pick<
        Brand,
        PurchaseChannelCamelField
      >[typeof purchaseField];
      continue;
    }

    switch (key) {
      case "name":
        partial.name = snapshot.name as Brand["name"];
        break;
      case "romanizedName":
        partial.romanizedName =
          snapshot.romanizedName as Brand["romanizedName"];
        break;
      case "description":
        partial.description = snapshot.description as Brand["description"];
        break;
      case "productType": {
        const productType = snapshot.productType as Brand["productType"];
        partial.productType = productType;
        partial.category = productType
          ? (deriveCategoryFromProductType(productType) ?? productType)
          : null;
        break;
      }
      case "foundingYear":
        partial.foundingYear = snapshot.foundingYear as Brand["foundingYear"];
        break;
      case "socialInstagram":
        partial.socialInstagram =
          snapshot.socialInstagram as Brand["socialInstagram"];
        break;
      case "socialThreads":
        partial.socialThreads =
          snapshot.socialThreads as Brand["socialThreads"];
        break;
      case "socialFacebook":
        partial.socialFacebook =
          snapshot.socialFacebook as Brand["socialFacebook"];
        break;
      case "heroImageUrl":
        partial.heroImageUrl = snapshot.heroImageUrl as Brand["heroImageUrl"];
        break;
      case "productPhotos":
        partial.productPhotos =
          (snapshot.productPhotos as Brand["productPhotos"]) ?? [];
        break;
      case "priceRange":
        partial.priceRange = snapshot.priceRange as Brand["priceRange"];
        break;
      case "productTags":
        partial.productTags =
          (snapshot.productTags as Brand["productTags"]) ?? [];
        break;
      case "mitStory":
        partial.mitStory = snapshot.mitStory as string | null;
        break;
      case "otherUrls":
        partial.otherUrls = (snapshot.otherUrls as Brand["otherUrls"]) ?? [];
        break;
      case "reputationSummary":
        partial.reputationSummary =
          snapshot.reputationSummary as Brand["reputationSummary"];
        break;
    }
  }

  return partial;
}

export function mergeDraftOverBrand(
  brand: Brand,
  snapshot: Record<string, unknown> | null,
): Brand {
  return snapshot ? { ...brand, ...draftSnapshotToDomain(snapshot) } : brand;
}

export function diffRemovedImageUrls(
  previous: string[],
  next: string[],
): string[] {
  const nextUrls = new Set(next.filter(Boolean));
  return previous.filter((url) => Boolean(url) && !nextUrls.has(url));
}

export function brandToDomain(row: BrandRowWithJoins): Brand {
  const owners = Array.isArray(row.brand_owners)
    ? row.brand_owners
    : row.brand_owners
      ? [row.brand_owners]
      : [];

  const purchaseFields = Object.fromEntries(
    PURCHASE_CHANNELS.map((channel) => [
      channel.camel,
      row[channel.column] ?? null,
    ]),
  ) as Pick<Brand, PurchaseChannelCamelField>;

  const brand = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    romanizedName: row.romanized_name ?? null,
    description: row.description ?? null,
    descriptionEn: row.description_en ?? null,
    blurb: row.blurb ?? null,
    blurbEn: row.blurb_en ?? null,
    heroImageUrl: row.hero_image_url ?? null,
    heroImageMetadata: null,
    // status is text in the DB — cast to BrandStatus at the boundary
    status: row.status as Brand["status"],
    product_type: row.product_type ?? null,
    productType: row.product_type ?? null,
    category:
      deriveCategoryFromProductType(row.product_type ?? "") ??
      row.product_type ??
      null,
    isVerified: owners.length > 0,
    mitStatus: (row.mit_status as Brand["mitStatus"]) ?? "unverified",
    mitDeclaredScope:
      (row.mit_declared_scope as Brand["mitDeclaredScope"]) ?? null,
    mitDeclaredAt: row.mit_declared_at ?? null,
    mitVerifiedAt: row.mit_verified_at ?? null,
    mitEvidence: (row.mit_evidence as Brand["mitEvidence"]) ?? null,
    mitVerified: row.mit_status === "verified",
    mitStory: row.mit_story ?? null,
    isDemo: row.is_demo ?? false,
    foundingYear: row.founding_year ?? null,
    city: row.city ?? null,
    socialInstagram: row.social_instagram ?? null,
    socialThreads: row.social_threads ?? null,
    socialFacebook: row.social_facebook ?? null,
    ...purchaseFields,
    otherUrls: (row.other_urls as OtherUrl[]) ?? [],
    productPhotos: [],
    imageAlts: [],
    contactEmail: row.contact_email ?? null,
    priceRange: row.price_range ?? null,
    productTags: Array.isArray(row.product_tags) ? row.product_tags : [],
    productTagsEn: Array.isArray(row.product_tags_en)
      ? row.product_tags_en
      : [],
    reputationSummary: normalizeReputationSummary(row.reputation_summary),
    siteContent: normalizeSiteContent(row.site_content as Brand["siteContent"]),
    submittedAt: row.submitted_at ?? "",
    approvedAt: row.approved_at ?? null,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
    onboardingDismissedAt: row.onboarding_dismissed_at ?? null,
  };
  return brand;
}

async function brandToDomainWithImages(
  supabase: unknown,
  row: BrandRowWithJoins,
): Promise<Brand> {
  const brand = brandToDomain(row);
  const images = await getBrandImages(supabase, brand.id);
  if (images.length === 0) return brand;
  return { ...brand, ...toImageFields(images) };
}

export function brandToInsert(data: BrandWriteInput): Record<string, unknown> {
  const row = baseToBrandRow(data);
  if (data.reputationSummary !== undefined) {
    row.reputation_summary =
      data.reputationSummary as typeof row.reputation_summary;
  }
  if (data.mitEvidence !== undefined) {
    row.mit_evidence = data.mitEvidence;
  }
  if (data.siteContent !== undefined) {
    row.site_content = data.siteContent;
  }
  return row;
}

function brandToUpdate(data: BrandWriteInput): Record<string, unknown> {
  const row = brandToInsert(data);
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key.includes("_")) {
      row[key] = value;
    }
  }
  const raw = data as Record<string, unknown>;
  if (data.priceRange === undefined && raw.price_range === undefined)
    delete row.price_range;
  if (data.productTags === undefined && raw.product_tags === undefined)
    delete row.product_tags;
  return row;
}

function brandFieldStateTable(client: unknown): BrandFieldStateTable {
  return (
    client as { from: (table: "brand_field_state") => BrandFieldStateTable }
  ).from("brand_field_state");
}

function brandPatchRpc(client: unknown): BrandPatchRpcClient {
  return client as BrandPatchRpcClient;
}

async function loadBrandFieldState(
  supabase: unknown,
  brandId: string,
): Promise<Record<string, BrandFieldWriteState>> {
  const { data, error } = await brandFieldStateTable(supabase)
    .select("field, source, updated_at")
    .eq("brand_id", brandId);

  if (error) throw error;

  return Object.fromEntries(
    (data ?? []).map((row) => [
      row.field,
      {
        source: row.source,
        updatedAt: row.updated_at,
      },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/** Every column the brand detail paths hydrate. */
export const BRAND_COLUMN_LIST = [
  "id",
  "name",
  "slug",
  "description",
  "description_en",
  "blurb",
  "blurb_en",
  "hero_image_url",
  "product_type",
  "contact_email",
  "city",
  ...PURCHASE_COLUMNS,
  "social_instagram",
  "social_threads",
  "social_facebook",
  "other_urls",
  "site_content",
  "status",
  "submitted_at",
  "approved_at",
  "created_at",
  "updated_at",
  "onboarding_dismissed_at",
  "draft_data",
  "draft_updated_at",
  "founding_year",
  "price_range",
  "product_tags",
  "product_tags_en",
  "reputation_summary",
  "mit_status",
  "mit_declared_scope",
  "mit_declared_at",
  "mit_verified_at",
  "mit_story",
  "mit_evidence",
  "source",
  "is_demo",
] as const;

/**
 * Large jsonb payloads (and unpublished editorial content) that brand cards and
 * directory structured data never render. Every one of them is serialized into
 * the RSC payload once per card, so a 12-card page ships 12 copies for nothing;
 * `draft_data` additionally leaks unpublished editorial content to the client.
 * Detail paths keep the full projection — narrow only list/card queries.
 */
export const DIRECTORY_OMITTED_COLUMNS = [
  "site_content",
  "draft_data",
  "mit_evidence",
  "reputation_summary",
] as const;

/** Columns hydrated by directory/card queries: the full list minus the four above. */
export const DIRECTORY_BRAND_COLUMN_LIST = BRAND_COLUMN_LIST.filter(
  (column) =>
    !(DIRECTORY_OMITTED_COLUMNS as readonly string[]).includes(column),
);

const BRAND_COLUMNS = BRAND_COLUMN_LIST.join(", ");
const DIRECTORY_BRAND_COLUMNS = DIRECTORY_BRAND_COLUMN_LIST.join(", ");

export const BRAND_SELECT =
  `${BRAND_COLUMNS}, brand_owners(user_id)` as unknown as "*";
const BRAND_SELECT_WITH_ROMANIZED_NAME =
  `${BRAND_COLUMNS}, romanized_name, brand_owners(user_id)` as unknown as "*";
const VERIFIED_BRAND_SELECT =
  `${BRAND_COLUMNS}, brand_owners!inner(user_id)` as unknown as "*";
/** Narrow projection for directory/card queries. */
const BRAND_LIST_SELECT =
  `${DIRECTORY_BRAND_COLUMNS}, brand_owners(user_id)` as unknown as "*";
const VERIFIED_BRAND_LIST_SELECT =
  `${DIRECTORY_BRAND_COLUMNS}, brand_owners!inner(user_id)` as unknown as "*";

/**
 * PostgREST sends `.in()` filters in the GET query string, so a single call with
 * a few hundred ids overruns the request-line limit and comes back as a bare
 * 400 Bad Request. 200 matches the chunk size already used in
 * `services/submissions.ts`.
 */
const SUPABASE_IN_FILTER_CHUNK_SIZE = 200;

export async function getBrandSlugsBatch(
  brandIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(brandIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  const supabase = createServiceClient();

  const chunks: string[][] = [];
  for (
    let index = 0;
    index < uniqueIds.length;
    index += SUPABASE_IN_FILTER_CHUNK_SIZE
  ) {
    chunks.push(uniqueIds.slice(index, index + SUPABASE_IN_FILTER_CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, slug")
        .in("id", chunk);
      if (error)
        throw new Error(`Failed to fetch brand slugs: ${error.message}`);
      return data ?? [];
    }),
  );

  return new Map(results.flat().map((b) => [b.id, b.slug]));
}

/**
 * Batched slug -> brand lookup for editorial content (story MDX shortcodes).
 *
 * Two failure modes, deliberately distinguished:
 *
 *  - **Unresolvable slug** — renamed, hidden, or never existed. Absent from the
 *    returned Map, no throw. Unlike `getBrandBySlug`, a whole story page must
 *    not 500 because one inline card cannot resolve; callers render a
 *    placeholder for any slug missing from the Map.
 *  - **Query failure** — pooler restart, statement timeout, bad credentials.
 *    Throws. Swallowing it returned an empty Map, which made *every* shortcode
 *    on the page render the missing-brand placeholder while the render itself
 *    *succeeded* — so ISR cached that degraded HTML for a full `revalidate`
 *    window with no error signal anywhere. Throwing fails the regeneration
 *    instead, which keeps the last good page served and surfaces the error.
 *
 * Uses the narrow `BRAND_LIST_SELECT` projection and plain `brandToDomain` —
 * `brandToDomainWithImages` would fire one extra query per brand. Under this
 * projection `productPhotos` stays `[]`, so cards fall back to `heroImageUrl`
 * and then `BrandImageFallback`.
 *
 * Cached per request, keyed on a joined slug string rather than the array:
 * React's `cache()` compares arguments by identity, and every shortcode builds
 * a fresh array literal, so an array-keyed cache would never hit. The key is
 * deduped *and sorted*, so `['a','b']` and `['b','a']` share one entry.
 *
 * What this does and does not dedupe: two calls with the same slug *set* share
 * one round trip. Calls with different sets do not — every `<BrandCard>` passes
 * a one-element array, so five distinct cards (including the three inside a
 * `<BrandRow>`, which only lays them out) still issue five queries. Only
 * `<BrandGrid>` is genuinely batched. Collapsing
 * the singles would need a per-request collector that knows the page's full
 * slug set before the first card renders, which RSC's streaming render does not
 * offer without changing this signature.
 *
 * Treat the returned Map as read-only — callers with the same slug set share
 * one instance.
 */
/**
 * The query itself, with the client passed in.
 *
 * Split out from the `cache()` wrapper below so tests can drive it with a
 * query-builder double instead of mocking `@/lib/supabase/server` — that mock
 * is what `scripts/check-test-boundaries.mjs` forbids. Production has exactly
 * one caller, immediately below; nothing else should pass a client here.
 */
async function queryApprovedBrandsBySlugs(
  supabase: ReturnType<typeof createServiceClient>,
  slugs: string[],
): Promise<Map<string, Brand>> {
  const { data, error } = await supabase
    .from("brands")
    .select(BRAND_LIST_SELECT)
    .in("slug", slugs)
    .eq("status", "approved");

  if (error) {
    // Logged as well as thrown: the throw fails ISR regeneration (which keeps
    // the last good page served), but without a log line the failed
    // regeneration leaves no trace anywhere.
    console.error("getBrandsBySlugKey query error:", error);
    throw new Error(`Failed to fetch brands by slug: ${error.message}`);
  }

  return new Map(
    (data ?? [])
      .map(brandToDomain)
      .map((brand): [string, Brand] => [brand.slug, brand]),
  );
}

/**
 * The query underneath throws on error, deliberately: during ISR regeneration a
 * throw keeps the last good page in the cache instead of replacing it with a
 * page of placeholders. That trade only works when a last good page EXISTS.
 *
 * During `next build` it does not, so the same throw aborts the export and
 * fails the whole build. CI builds this app with Supabase pointed at
 * 127.0.0.1 on purpose (the Build job is a compile check), so the first story
 * to embed a brand card turned a standing condition into a blocked deploy.
 *
 * Prerender therefore degrades to an empty map, reported through the same
 * `captureReadFailure` path as every other degraded page read, and gated on the
 * same `STRICT_PRERENDER_DATA` switch — a deploy build that genuinely expects a
 * database sets it and gets the hard failure back. Request and revalidation
 * renders are untouched and keep the throw.
 */
export async function fetchBrandsBySlugKey(
  supabase: ReturnType<typeof createServiceClient>,
  slugKey: string,
): Promise<Map<string, Brand>> {
  try {
    return await resolveBrandsBySlugKey(supabase, slugKey);
  } catch (error) {
    if (!canDegradeDuringPrerender()) throw error;
    captureReadFailure("stories.brandCards")(error);
    return new Map();
  }
}

async function resolveBrandsBySlugKey(
  supabase: ReturnType<typeof createServiceClient>,
  slugKey: string,
): Promise<Map<string, Brand>> {
  const requested = slugKey.split("\n");
  const bySlug = await queryApprovedBrandsBySlugs(supabase, requested);

  const unresolved = requested.filter((slug) => !bySlug.has(slug));
  // The overwhelmingly common case: nothing was renamed, so this stays a
  // single round trip. The two extra queries below are only ever paid on a
  // page that would otherwise have rendered a placeholder anyway.
  if (unresolved.length === 0) return bySlug;

  /*
   * Renamed-slug recovery.
   *
   * Editorial content (story MDX shortcodes, the event lineup manifest) pins
   * brands by slug, but a slug is not immutable: a brand refresh re-derives it
   * from the name, and on 2026-08-02 twelve brands were renamed in one batch,
   * silently turning five story cards into "找不到品牌" placeholders and
   * staling twelve event lineup entries.
   *
   * `brand_slug_redirects` already records every rename — `proxy.ts` uses it so
   * /brands/<old> still resolves. This makes the *embedded* lookups honour the
   * same table, so a rename can no longer break content that links to a brand.
   *
   * ONE hop, deliberately: a chain (a→b→c) resolves only its last leg here.
   * Chains are rare, each rename writes a row pointing at the then-current
   * slug, and looping would turn an unbounded table into an unbounded query
   * count on a request path. A stale chain degrades to today's placeholder.
   */
  const { data: redirects, error: redirectError } = await supabase
    .from("brand_slug_redirects")
    .select("old_slug, new_slug")
    .in("old_slug", unresolved);

  if (redirectError) {
    // Deliberately NOT thrown, unlike the brand query above. This path is
    // best-effort recovery for slugs that already failed to resolve; failing
    // the whole render would take down a page whose other cards are fine.
    console.error("brand slug redirect lookup failed:", redirectError);
    return bySlug;
  }

  const hops = (redirects ?? []).filter(
    (row): row is { old_slug: string; new_slug: string } =>
      typeof row?.old_slug === "string" && typeof row?.new_slug === "string",
  );
  if (hops.length === 0) return bySlug;

  const targets = [...new Set(hops.map((row) => row.new_slug))].filter(
    (slug) => !bySlug.has(slug),
  );
  const renamed =
    targets.length > 0
      ? await queryApprovedBrandsBySlugs(supabase, targets)
      : new Map<string, Brand>();

  for (const { old_slug: oldSlug, new_slug: newSlug } of hops) {
    // Keyed by the slug the CALLER asked for: callers look the brand up by the
    // slug they authored. The Brand itself still carries its current slug, so
    // the rendered link points at the canonical URL rather than the redirect.
    const brand = renamed.get(newSlug) ?? bySlug.get(newSlug);
    if (brand) bySlug.set(oldSlug, brand);
  }

  return bySlug;
}

const getBrandsBySlugKey = cache(
  (slugKey: string): Promise<Map<string, Brand>> =>
    fetchBrandsBySlugKey(createServiceClient(), slugKey),
);

/**
 * Slugs are kebab-case, so a newline is a safe separator for the cache key.
 * Deduped and sorted, so call order cannot fork one lookup into two identical
 * round trips.
 */
export function brandsBySlugsCacheKey(slugs: string[]): string {
  return [...new Set(slugs)].sort().join("\n");
}

export async function getBrandsBySlugs(
  slugs: string[],
): Promise<Map<string, Brand>> {
  if (slugs.length === 0) return new Map();
  return getBrandsBySlugKey(brandsBySlugsCacheKey(slugs));
}

export type BrandImageFields = ReturnType<typeof toImageFields>;

/**
 * The full `brand_images` list for one brand, as domain image fields.
 *
 * `getBrandsBySlugs` runs the narrow directory projection, which leaves
 * `productPhotos` empty — enough for a card that shows one hero, not enough for
 * a story gallery that wants four photos. Rather than widen that projection for
 * every card on the directory, gallery callers pay one extra query here.
 * Cached per request so repeated galleries for the same brand share it.
 */
export const getBrandImageFields = cache(
  async (brandId: string): Promise<BrandImageFields> =>
    toImageFields(await getBrandImages(createServiceClient(), brandId)),
);

type GetBrandsFilters = BrandFilters & {
  page?: number;
  subcategoryTags?: string[];
  /**
   * Opt in to the full column projection (jsonb blobs + draft data). Public
   * directory callers must leave this off — those columns are dead weight in
   * the RSC payload. Only the admin table, which renders `mitEvidence`, needs it.
   */
  includeDetailColumns?: boolean;
};

function getBrandsSelect(filters: GetBrandsFilters | undefined): "*" {
  const owned = filters?.verificationFilter === "owned";
  if (filters?.includeDetailColumns) {
    return owned ? VERIFIED_BRAND_SELECT : BRAND_SELECT;
  }
  return owned ? VERIFIED_BRAND_LIST_SELECT : BRAND_LIST_SELECT;
}

function getSearchPagination(filters: GetBrandsFilters): {
  offset: number;
  limit?: number;
} {
  if (filters.limit !== undefined) {
    return {
      offset:
        filters.offset ??
        (filters.page ? (filters.page - 1) * filters.limit : 0),
      limit: filters.limit,
    };
  }

  if (filters.page !== undefined) {
    return {
      offset: (filters.page - 1) * DEFAULT_PAGE_SIZE,
      limit: DEFAULT_PAGE_SIZE,
    };
  }

  return { offset: filters.offset ?? 0 };
}

export async function getBrands(
  filters?: GetBrandsFilters,
): Promise<{ brands: Brand[]; totalCount: number }> {
  const supabase = createServiceClient();

  // Search filtering is handled in search_brands; this branch only hydrates the matched IDs.
  // Use typeof check so empty string '' still enters this branch and returns early (not fallthrough to browse).
  if (typeof filters?.search === "string") {
    const trimmed = filters.search.trim().slice(0, 100);
    if (!trimmed) {
      return { brands: [], totalCount: 0 };
    }

    const verificationFilter =
      filters.verificationFilter && filters.verificationFilter !== "all"
        ? filters.verificationFilter
        : null;

    const { data: rpcData, error: rpcError } = (await supabase.rpc(
      "search_brands",
      {
        search_query: trimmed,
        result_limit: null,
        prefix_mode: false,
        filter_categories: filters.category?.length ? filters.category : null,
        filter_tags: filters.subcategoryTags?.length
          ? filters.subcategoryTags
          : null,
        filter_verification: verificationFilter,
        filter_status: filters.status || "approved",
        include_test_brands: filters.includeTestBrands ?? false,
      },
    )) as SearchBrandsResult;

    if (rpcError) {
      console.error("getBrands search_brands RPC error:", rpcError);
      return { brands: [], totalCount: 0 };
    }

    let matchedRows = rpcData ?? [];
    if (filters.priceRanges?.length && matchedRows.length > 0) {
      const { data: priceMatches, error: priceError } = await supabase
        .from("brands")
        .select("id")
        .in(
          "id",
          matchedRows.map((row) => row.id),
        )
        .in("price_range", filters.priceRanges);

      if (priceError) throw priceError;
      const matchingIds = new Set((priceMatches ?? []).map((row) => row.id));
      matchedRows = matchedRows.filter((row) => matchingIds.has(row.id));
    }

    const searchResults: SearchResult[] = matchedRows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      category: row.primary_category_name ?? "",
      rankScore: row.rank_score,
      searchSource: row.search_source,
      similarity: row.rank_score,
    }));
    const allIds = searchResults.map((result) => result.id);
    const totalCount = allIds.length;
    if (totalCount === 0) {
      return { brands: [], totalCount: 0 };
    }

    const selectClause = getBrandsSelect(filters);
    const { offset, limit: pageLimit } = getSearchPagination(filters);
    const pageEnd = pageLimit === undefined ? undefined : offset + pageLimit;

    async function hydrateByIds(ids: string[]): Promise<Brand[]> {
      if (ids.length === 0) return [];

      const { data, error } = await supabase
        .from("brands")
        .select(selectClause)
        .in("id", ids);

      if (error) throw error;

      return (data ?? []).map(brandToDomain);
    }

    const sortKey = filters.sort;

    if (!sortKey || sortKey === "random") {
      const pageIds = allIds.slice(offset, pageEnd);
      const rankById = new Map(pageIds.map((id, index) => [id, index]));
      const brands = (await hydrateByIds(pageIds)).sort(
        (left, right) =>
          (rankById.get(left.id) ?? 0) - (rankById.get(right.id) ?? 0),
      );
      return { brands, totalCount };
    }

    const sortConfig = BRAND_SORT_CONFIG[sortKey];
    // Sort and paginate in Postgres: hydrating every matched row only to slice
    // 12 of them in JS meant a broad search read ~400 full rows per page.
    // The id tiebreaker makes the order total — without it, rows tied on the
    // sort column can repeat or disappear between .range() windows.
    const rangeEnd =
      pageLimit === undefined ? totalCount - 1 : offset + pageLimit - 1;
    if (offset > rangeEnd) return { brands: [], totalCount };

    const { data, error } = await supabase
      .from("brands")
      .select(selectClause)
      .in("id", allIds)
      .order(sortConfig.column, { ascending: sortConfig.ascending })
      .order("id", { ascending: true })
      .range(offset, rangeEnd);

    if (error) {
      if (error.code === "PGRST103") return { brands: [], totalCount };
      throw error;
    }

    return { brands: (data ?? []).map(brandToDomain), totalCount };
  }

  const verificationFilter = filters?.verificationFilter;
  const selectClause = getBrandsSelect(filters);

  let query = supabase.from("brands").select(selectClause, { count: "exact" });

  if (verificationFilter === "mit-verified") {
    query = query.eq("mit_status", "verified");
  } else if (verificationFilter === "mit-declared") {
    query = query.eq("mit_status", "declared");
  }

  if (!filters?.includeTestBrands) {
    query = excludeTestBrands(query);
  }
  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.category && filters.category.length > 0) {
    query = query.in("product_type", filters.category);
  }
  if (filters?.priceRanges && filters.priceRanges.length > 0) {
    query = query.in("price_range", filters.priceRanges);
  }
  if (filters?.subcategoryTags && filters.subcategoryTags.length > 0) {
    query = query.overlaps("product_tags", filters.subcategoryTags);
  }

  // Sorting
  const sortKey = filters?.sort ?? "random";
  if (sortKey !== "random") {
    const sortConfig = BRAND_SORT_CONFIG[sortKey];
    // The id tiebreaker makes the order total. Many brands tie on the sort column
    // (NULL founding_year, bulk-import approved_at), and without a total order the
    // .range() windows below can repeat a row on two pages and drop another.
    query = query.order(sortConfig.column, { ascending: sortConfig.ascending });
    query = query.order("id", { ascending: true });
  } else {
    // Postgres gives no stable row order without ORDER BY, so .range() below
    // could repeat or drop rows across pages. Paginate over a deterministic
    // id sequence; the daily shuffle then reorders within each returned page.
    query = query.order("id", { ascending: true });
  }

  // Pagination
  if (filters?.limit !== undefined) {
    const offset = filters.offset ?? 0;
    query = query.range(offset, offset + filters.limit - 1);
  }

  const { data, error, count } = await query;

  if (error) {
    if (error.code === "PGRST103")
      return { brands: [], totalCount: count ?? 0 };
    throw error;
  }
  const brands = (data ?? []).map(brandToDomain);
  if (sortKey === "random") shuffleArray(brands, getDailySeed());
  return { brands, totalCount: count ?? 0 };
}

export async function getSubcategoryCounts(
  categorySlug: string,
): Promise<Map<string, number>> {
  const supabase = createServiceClient();
  const { data, error } = await excludeTestBrands(
    supabase
      .from("brands")
      .select("product_tags")
      .eq("status", "approved")
      .eq("product_type", categorySlug),
  );

  if (error) throw error;

  const brands = (data ?? []).map((row) => ({
    productTags: Array.isArray(row.product_tags) ? row.product_tags : [],
  }));
  const counts = new Map<string, number>();

  for (const brand of brands) {
    const canonicalTags = new Set<string>();
    for (const tag of brand.productTags) {
      const subcategory = matchSubcategory(tag);
      if (subcategory?.category === categorySlug) {
        canonicalTags.add(subcategory.nameZh);
      }
    }
    for (const tag of canonicalTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return counts;
}

export const EXPLORE_BRAND_LIMIT = 8;

const getCachedExploreBrandPool = unstable_cache(
  () =>
    auditedCall(
      {
        provider: "cache",
        operation: "getCachedExploreBrandPool",
        kind: "service",
      },
      () =>
        getBrands({
          status: "approved",
          sort: "random",
          limit: 200,
        }),
      { summary: { cached: true } },
    ),
  ["homepage-explore-brand-pool"],
  { revalidate: 3600, tags: [PUBLIC_BRAND_DATA_TAG] },
);

function selectCategoryBalancedBrands(
  brands: Brand[],
  categorySlugs: readonly string[],
  limit = categorySlugs.length,
): Brand[] {
  const selectionLimit = Math.max(0, Math.floor(limit));
  const selected: Brand[] = [];
  const selectedIds = new Set<string>();

  for (const categorySlug of categorySlugs) {
    if (selected.length >= selectionLimit) break;

    const brand = brands.find(
      (candidate) =>
        candidate.productType === categorySlug &&
        !selectedIds.has(candidate.id),
    );
    if (!brand) continue;

    selected.push(brand);
    selectedIds.add(brand.id);
  }

  for (const brand of brands) {
    if (selected.length >= selectionLimit) break;
    if (selectedIds.has(brand.id)) continue;

    selected.push(brand);
    selectedIds.add(brand.id);
  }

  return selected;
}

export async function getExploreBrands(
  limit = EXPLORE_BRAND_LIMIT,
): Promise<{ brands: Brand[]; totalCount: number }> {
  const { brands, totalCount } = await getCachedExploreBrandPool();
  const categorySlugs = PRODUCT_TYPE_CATEGORIES.map(({ slug }) => slug);

  return {
    brands: selectCategoryBalancedBrands(brands, categorySlugs, limit),
    totalCount,
  };
}

export async function searchBrandsAutocomplete(
  query: string,
  limit?: number,
): Promise<SearchBrandAutocompleteResult[]> {
  const supabase = createServiceClient();
  const { data, error } = (await supabase.rpc("search_brands", {
    search_query: query,
    prefix_mode: true,
    result_limit: limit ?? 5,
  })) as SearchBrandsResult;

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.primary_category_name ?? "",
  }));
}

export async function getBrandBySlug(
  slug: string,
  options: { includeRomanizedName?: boolean } = {},
): Promise<Brand> {
  const supabase = createServiceClient();
  let { data, error } = await supabase
    .from("brands")
    .select(
      options.includeRomanizedName
        ? BRAND_SELECT_WITH_ROMANIZED_NAME
        : BRAND_SELECT,
    )
    .eq("slug", slug)
    .maybeSingle();

  if (options.includeRomanizedName && error?.code === "42703") {
    ({ data, error } = await supabase
      .from("brands")
      .select(BRAND_SELECT)
      .eq("slug", slug)
      .maybeSingle());
  }

  if (error || !data) throw new NotFoundError("Brand", slug, { cause: error });
  return brandToDomainWithImages(supabase, data);
}

/**
 * Returns an approved brand by slug.
 * Throws {@link NotFoundError} if the brand does not exist or is not approved.
 */
export async function getApprovedBrandBySlug(slug: string): Promise<Brand> {
  const brand = await getBrandBySlug(slug);
  if (brand.status !== "approved") throw new NotFoundError("Brand", slug);
  return brand;
}

async function resolveUniqueRomanizedSlug(
  supabase: ReturnType<typeof createServiceClient>,
  baseSlug: string,
  brandId: string,
): Promise<string> {
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    if (!isReservedSlug(candidate)) {
      const { data, error } = await supabase
        .from("brands")
        .select("id")
        .eq("slug", candidate)
        .neq("id", brandId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return candidate;
    }

    candidate = withSlugSuffix(baseSlug, suffix);
    suffix += 1;
  }
}

export async function updateBrand(
  id: string,
  data: BrandWriteInput,
  actor: BrandWriteActor = { source: "admin" },
): Promise<BrandWriteResult> {
  return auditedCall(
    { provider: "brands", operation: "updateBrand", kind: "service" },
    async () => {
  const supabase = createServiceClient();
  const normalizedData =
    data.romanizedName === undefined
      ? data
      : { ...data, romanizedName: data.romanizedName?.trim() || null };
  const row = brandToUpdate(normalizedData);
  let romanizedSlugBase: string | null = null;

  if (normalizedData.romanizedName !== undefined) {
    const { data: current, error: currentError } = await supabase
      .from("brands")
      .select("slug")
      .eq("id", id)
      .single();

    if (currentError || !current) {
      throw new NotFoundError("Brand", id, { cause: currentError });
    }

    romanizedSlugBase = slugifyRomanizedName(normalizedData.romanizedName);
    if (romanizedSlugBase && romanizedSlugBase !== current.slug) {
      row.slug = await resolveUniqueRomanizedSlug(
        supabase,
        romanizedSlugBase,
        id,
      );
    }
  }

  const fieldState =
    actor.source === "admin" ? {} : await loadBrandFieldState(supabase, id);
  const { allowed, skipped } = resolveWritablePatch(row, fieldState, actor);

  if (Object.keys(allowed).length > 0) {
    let { error: patchError } = await brandPatchRpc(supabase).rpc(
      "apply_brand_patch",
      {
        p_brand_id: id,
        p_patch: allowed,
        p_source: actor.source,
        p_actor: actor.userId ?? null,
        p_job_id: actor.jobId ?? null,
      },
    );

    if (patchError?.code === "23505" && romanizedSlugBase && allowed.slug) {
      allowed.slug = await resolveUniqueRomanizedSlug(
        supabase,
        romanizedSlugBase,
        id,
      );
      ({ error: patchError } = await brandPatchRpc(supabase).rpc(
        "apply_brand_patch",
        {
          p_brand_id: id,
          p_patch: allowed,
          p_source: actor.source,
          p_actor: actor.userId ?? null,
          p_job_id: actor.jobId ?? null,
        },
      ));
    }

    if (patchError) throw patchError;
  }

  const { data: updated, error } = await supabase
    .from("brands")
    .select(BRAND_SELECT)
    .eq("id", id)
    .single();

  if (error || !updated) throw new NotFoundError("Brand", id, { cause: error });
  return {
    ...brandToDomain(updated),
    skipped,
  };
    },
  );
}

export async function saveDraft(
  brandId: string,
  data: Partial<Brand>,
): Promise<void> {
  return auditedCall(
    { provider: "brands", operation: "saveDraft", kind: "service" },
    async () => {
  const supabase = createServiceClient();
  const { error, count } = await supabase
    .from("brands")
    .update(
      {
        draft_data: brandToDraftSnapshot(data) as BrandDraftData,
        draft_updated_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("id", brandId);

  if (error) throw error;
  if (count === 0) throw new NotFoundError("Brand", brandId);
    },
  );
}

export async function getBrandDraft(
  brandId: string,
): Promise<Record<string, unknown> | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brands")
    .select("draft_data")
    .eq("id", brandId)
    .maybeSingle();

  if (error) throw error;
  return draftDataToSnapshot(data?.draft_data ?? null);
}

/**
 * `actor` decides the provenance stamped on every published field. It must be
 * passed: the default is `admin`, and an owner edit recorded as `admin` is not
 * protected from an enrichment refresh, because only `owner` blocks one.
 */
export async function publishDraft(
  brandId: string,
  actor: BrandWriteActor,
): Promise<Brand> {
  return auditedCall(
    { provider: "brands", operation: "publishDraft", kind: "service" },
    async () => {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brands")
    .select("draft_data, draft_updated_at")
    .eq("id", brandId)
    .single();

  if (error || !data)
    throw new NotFoundError("Brand", brandId, { cause: error });

  const snapshot = draftDataToSnapshot(data.draft_data);
  if (!snapshot) throw new ValidationError("No draft to publish");

  const partial = draftSnapshotToDomain(snapshot);
  if (Object.keys(partial).length > 0) {
    const draftUpdatedAt = data.draft_updated_at;
    const draftTimestamp = draftUpdatedAt
      ? Date.parse(draftUpdatedAt)
      : Number.NaN;
    if (!Number.isFinite(draftTimestamp)) {
      throw new ConflictError("Draft timestamp is missing or invalid");
    }

    const fieldState = await loadBrandFieldState(supabase, brandId);
    const patch = brandToUpdate(partial);
    const hasStaleField = Object.keys(patch).some((field) => {
      const fieldTimestamp = Date.parse(fieldState[field]?.updatedAt ?? "");
      return Number.isFinite(fieldTimestamp) && fieldTimestamp > draftTimestamp;
    });

    if (hasStaleField) {
      throw new ConflictError("Draft conflicts with newer brand edits");
    }
  }

  const published = await updateBrand(brandId, partial, actor);

  const { error: clearError, count } = await supabase
    .from("brands")
    .update({ draft_data: null, draft_updated_at: null }, { count: "exact" })
    .eq("id", brandId);

  if (clearError) throw clearError;
  if (count === 0) throw new NotFoundError("Brand", brandId);

  return published;
    },
  );
}

/**
 * Builds an actionable message for a trigger-vetoed brand delete. The raw
 * `P0001` text names neither the brand nor the rows holding it — the admin UI
 * showed a bare "Refresh snapshot is immutable" with no next step (DEV-1331).
 */
async function describeBlockedBrandDelete(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
  reason: string,
): Promise<string> {
  const { data: brand } = await supabase
    .from("brands")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  const { count } = await supabase
    .from("brand_submissions")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", id);

  const label = brand?.name ? `"${brand.name}" (${id})` : id;
  return `Cannot delete brand ${label}: ${reason}. ${count ?? 0} brand_submissions row(s) still reference it.`;
}

export async function deleteBrand(id: string): Promise<void> {
  return auditedCall(
    { provider: "brands", operation: "deleteBrand", kind: "service" },
    async () => {
  const supabase = createServiceClient();
  const { error, count } = await supabase
    .from("brands")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) {
    // P0001 is a `raise exception` from one of the brand_submissions guards.
    if (error.code === "P0001") {
      throw new ConflictError(
        await describeBlockedBrandDelete(supabase, id, error.message),
        { cause: error },
      );
    }
    throw error;
  }
  if (count === 0) throw new NotFoundError("Brand", id);
    },
  );
}

export async function getRelatedBrands(
  categorySlug: string,
  excludeSlug: string,
  limit = 4,
): Promise<Brand[]> {
  if (!categorySlug) return [];

  const { brands } = await getBrands({
    category: [categorySlug],
    status: "approved",
    sort: "random",
    limit: limit + 1,
  });

  return brands.filter((brand) => brand.slug !== excludeSlug).slice(0, limit);
}

export async function getBrandCountByCategory(
  categorySlug: string,
  excludeSlug: string,
): Promise<number> {
  if (!categorySlug) return 0;

  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("brands")
    .select("*", { count: "exact", head: true })
    .eq("status", "approved")
    .eq("product_type", categorySlug)
    .neq("slug", excludeSlug);

  if (error) throw error;
  return count ?? 0;
}

export async function getAllBrandSlugs(): Promise<string[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brands")
    .select("slug")
    .eq("status", "approved");

  if (error) throw error;
  return (data ?? []).map((row) => row.slug);
}

export type BrandSeoEntry = {
  slug: string;
  updatedAt: string;
  productType: string | null;
  description: string | null;
  descriptionEn: string | null;
  blurbEn: string | null;
};

export async function getBrandSeoEntries(): Promise<BrandSeoEntry[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brands")
    .select(
      "slug, updated_at, product_type, description, description_en, blurb_en",
    )
    .eq("status", "approved");

  if (error) throw error;
  return (data ?? []).map((row) => ({
    slug: row.slug,
    updatedAt: row.updated_at,
    productType: row.product_type,
    description: row.description,
    descriptionEn: row.description_en,
    blurbEn: row.blurb_en,
  }));
}

export async function getMicrositeSlugs(): Promise<string[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brands")
    .select("slug")
    .eq("status", "approved")
    .not("site_content", "is", null);

  if (error) throw error;
  return (data ?? []).map((row) => row.slug);
}

export async function getBrandById(id: string): Promise<Brand> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brands")
    .select(BRAND_SELECT)
    .eq("id", id)
    .single();

  if (error || !data) throw new NotFoundError("Brand", id, { cause: error });
  return brandToDomainWithImages(supabase, data);
}

/**
 * Our own Storage origin, or any `*.supabase.co` host serving `/storage/`.
 * Exported so scripts/seed-events.ts validates hero images against the same
 * rule instead of keeping its own copy.
 */
export function isSupabaseStorageUrl(url: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const storagePrefix = supabaseUrl ? `${supabaseUrl}/storage/` : "";

  if (storagePrefix && url.startsWith(storagePrefix)) {
    return true;
  }

  try {
    const parsedUrl = new URL(url);
    const normalizedHostname = parsedUrl.hostname.toLowerCase();

    return (
      normalizedHostname.endsWith(".supabase.co") &&
      parsedUrl.pathname.startsWith("/storage/")
    );
  } catch {
    return false;
  }
}

export function collectSyncableImageUrls(input: {
  heroImageUrl: string | null;
  productPhotos: string[];
}): string[] {
  const urls = [input.heroImageUrl, ...input.productPhotos];

  return urls.filter((url): url is string => {
    if (!url) {
      return false;
    }

    return !isSupabaseStorageUrl(url) && !isNonImageHost(url);
  });
}

export type ImageRef = {
  url: string;
  field: "hero" | "photo";
  index?: number;
};

export function buildSyncedImagePatch(
  refs: ImageRef[],
  storedUrls: (string | null)[],
  productPhotos: string[],
): Partial<{ heroImageUrl: string; productPhotos: string[] }> {
  const patch: Partial<{ heroImageUrl: string; productPhotos: string[] }> = {};
  const updatedPhotos = [...productPhotos];

  for (let i = 0; i < refs.length; i++) {
    const stored = storedUrls[i];
    if (stored == null) {
      continue;
    }

    const ref = refs[i];
    if (ref.field === "hero") patch.heroImageUrl = stored;
    else if (ref.field === "photo" && ref.index !== undefined)
      updatedPhotos[ref.index] = stored;
  }

  patch.productPhotos = updatedPhotos;
  return patch;
}

export async function syncBrandImages(
  brandId: string,
): Promise<{ synced: number; failed: number }> {
  return auditedCall(
    { provider: "brands", operation: "syncBrandImages", kind: "service" },
    async () => {
  const supabase = createServiceClient();
  const brand = await getBrandById(brandId);

  const syncableUrls = collectSyncableImageUrls({
    heroImageUrl: brand.heroImageUrl,
    productPhotos: brand.productPhotos,
  });

  if (syncableUrls.length === 0) return { synced: 0, failed: 0 };

  const refs: ImageRef[] = [];

  if (brand.heroImageUrl && syncableUrls.includes(brand.heroImageUrl)) {
    refs.push({ url: brand.heroImageUrl, field: "hero" });
  }
  for (let i = 0; i < brand.productPhotos.length; i++) {
    const url = brand.productPhotos[i];
    if (url && syncableUrls.includes(url)) {
      refs.push({ url, field: "photo", index: i });
    }
  }

  if (refs.length === 0) return { synced: 0, failed: 0 };

  const externalUrls = refs.map((r) => r.url);
  const storedUrls = await downloadAndStoreImages(externalUrls, brandId);
  for (let i = 0; i < refs.length; i++) {
    const storedUrl = storedUrls.at(i);
    if (storedUrl == null) continue;

    const ref = refs.at(i);
    if (!ref) continue;

    await insertBrandImage(supabase, {
      brand_id: brandId,
      url: storedUrl,
      source_url: ref.url,
      source: "admin",
      sort_order: i,
      // Both are product imagery under the two-tag vocabulary; only the
      // sort_order above distinguishes the hero from the rest.
      tags: ["product"],
    });
  }

  await syncHeroDenormalized(supabase, brandId);

  const failed = storedUrls.filter((u) => u == null).length;
  return { synced: storedUrls.length - failed, failed };
    },
  );
}

export async function completeBrandClaim({
  userId,
  brandId,
  email,
}: {
  userId: string;
  brandId: string;
  email: string;
}): Promise<void> {
  return auditedCall(
    { provider: "brands", operation: "completeBrandClaim", kind: "service" },
    async () => {
  const supabase = createServiceClient();

  const { data: existingOwnership, error: ownershipError } = await supabase
    .from("brand_owners")
    .select("brand_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (ownershipError) throw ownershipError;
  if (existingOwnership) {
    throw new ValidationError("This account already manages a brand");
  }

  const { error: insertError } = await supabase
    .from("brand_owners")
    .insert({ user_id: userId, brand_id: brandId })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      throw new ValidationError("This account already manages a brand", {
        cause: insertError,
      });
    }
    throw insertError;
  }

  const { error: updateError } = await supabase
    .from("brands")
    .update({ contact_email: email })
    .eq("id", brandId);

  if (updateError) throw updateError;
    },
  );
}

export async function getRandomBrands(limit = 4): Promise<Brand[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brands")
    .select(BRAND_LIST_SELECT)
    .eq("status", "approved")
    .limit(limit * 3);

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Fisher-Yates shuffle
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  return rows.slice(0, limit).map(brandToDomain);
}

export async function getNewBrands(limit = 4): Promise<Brand[]> {
  const newBrandPoolSize = 20;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brands")
    .select(BRAND_LIST_SELECT)
    .eq("status", "approved")
    .not("approved_at", "is", null)
    .order("approved_at", { ascending: false })
    .limit(newBrandPoolSize);

  if (error) throw error;
  const rows = data ?? [];
  shuffleArray(rows);
  return rows.slice(0, limit).map(brandToDomain);
}

const getCachedRecentBrandCount = unstable_cache(
  () => auditedCall(
    {
      provider: "cache",
      operation: "getCachedRecentBrandCount",
      kind: "service",
    },
    async (): Promise<{ count: number; period: "7d" | "30d" }> => {
    const supabase = createServiceClient();
    const now = new Date();
    const sevenDaysAgo = new Date(
      now.getTime() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const thirtyDaysAgo = new Date(
      now.getTime() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { count: weekCount, error: weekError } = await excludeTestBrands(
      supabase
        .from("brands")
        .select("*", { count: "exact", head: true })
        .eq("status", "approved")
        .gte("approved_at", sevenDaysAgo),
    );

    if (weekError) throw weekError;

    if ((weekCount ?? 0) > 0) {
      return { count: weekCount ?? 0, period: "7d" };
    }

    const { count: monthCount, error: monthError } = await excludeTestBrands(
      supabase
        .from("brands")
        .select("*", { count: "exact", head: true })
        .eq("status", "approved")
        .gte("approved_at", thirtyDaysAgo),
    );

    if (monthError) throw monthError;

    return { count: monthCount ?? 0, period: "30d" };
    },
    { summary: { cached: true } },
  ),
  ["recent-brand-count"],
  { revalidate: 3600, tags: [PUBLIC_BRAND_DATA_TAG] },
);

export async function getRecentBrandCount(): Promise<{
  count: number;
  period: "7d" | "30d";
}> {
  return getCachedRecentBrandCount();
}

export async function getBrandStats(): Promise<{
  brandCount: number;
  categoryCount: number;
}> {
  const supabase = createServiceClient();
  const [{ count, error }, { data: categoryRows, error: categoryError }] =
    await Promise.all([
      excludeTestBrands(
        supabase
          .from("brands")
          .select(BRAND_COLUMNS as "*", { count: "exact", head: true })
          .eq("status", "approved"),
      ),
      excludeTestBrands(
        supabase.from("brands").select("product_type").eq("status", "approved"),
      ).not("product_type", "is", null),
    ]);

  if (error) throw error;
  if (categoryError) throw categoryError;
  const categoryCount = new Set(
    (categoryRows ?? []).map((row) => row.product_type).filter(Boolean),
  ).size;
  return { brandCount: count ?? 0, categoryCount };
}
