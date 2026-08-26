import { auditedCall } from "@/lib/audit";
import { PRODUCTS_LABELS, PRODUCTS_SYSTEM_PROMPT } from "@/lib/prompts";
import {
  categoryLabelZh,
  L1_CATEGORIES,
  materialBySlug,
  matchSubcategory,
  subcategoryBySlug,
} from "@/lib/taxonomy/ontology";
import {
  CURATED_PRODUCT_SOURCE_TYPES,
  curatedProductProposalSchema,
  curatedProductSourceSchema,
  MAX_NOTE,
} from "@/lib/validation/curated-product";
import type {
  CuratedProductProposal,
  CuratedProductProposalSource,
} from "@/lib/types/enriched-data";
import type { PhaseResult } from "@/lib/types/curation";
import { generateSlug } from "../brands";
import { buildEnrichmentUserContent } from "../description-rewrite";
import {
  buildProfiledEnrichmentConfig,
  createProfiledOpenAIClient,
  profileChatParams,
} from "../llm-audit";
import { parseJson } from "../openai-client";
import {
  isLlmProviderFailure,
  type LlmCallCounts,
} from "../_shared/llm-call-outcome";
import {
  brandTarget,
  type EnrichmentTarget,
} from "../_shared/enrichment-target";
import { preferPatched } from "./descriptions";
import {
  classifyProductUrl,
  mergeCandidatePool,
  normalizeProductUrl,
  type ProductCandidate,
} from "./product-candidates";
import { loadStoredCandidates as defaultLoadStoredCandidates } from "./stored-product-candidates";
import {
  createDefaultCandidateWriter,
  persistCandidatePool,
  type CandidateWriter,
  type LlmRanker,
} from "../curated-products/candidate-selection";
import {
  buildPhaseResult,
  timePhase,
  type EnrichBrand,
  type EnrichPatch,
  type EnrichPhase,
  type EnrichScrapedData,
} from "./types";

/**
 * Curated-product proposals from a brand's own site (DEV-1469).
 *
 * The phase writes NO rows. It proposes at most five products, the proposals
 * ride the submission's `enriched_data.products[]`, a moderator ticks the
 * keepers in the existing submission review, and approval is what materializes
 * `curated_products`. Every validation rule below is written for that asymmetry:
 * a dropped proposal costs a moderator nothing, while a proposal carrying an
 * unresolvable slug costs a rejected write (`material` has a Postgres CHECK) or
 * a dead filter value on a public page.
 *
 * NO COMMERCE TRUTH reaches the payload: `CuratedProductProposal` has no price,
 * stock, availability, discount, offer or variant field, this file never reads
 * one off the model's reply, and `PRODUCTS_SYSTEM_PROMPT` forbids them twice.
 */

/** The phase ceiling. Five is a brand-page shelf, not a catalogue. */
const MAX_PROPOSALS = 5;
/** Both axes are labels on a card, not a taxonomy dump. */
const MAX_SUBCATEGORIES_PER_PRODUCT = 3;
const MAX_MATERIALS_PER_PRODUCT = 3;
/** A proposal cites its provenance; it does not carry a bibliography. */
const MAX_SOURCES_PER_PRODUCT = 5;
/** Candidate pages and images the user message carries, oldest-first by scrape order. */
const MAX_CANDIDATE_PAGES = 25;
const MAX_IMAGE_CANDIDATES = 12;
/** Per-page evidence is a title plus a lead, not the whole page. */
const PAGE_TEXT_LIMIT = 240;
const MAX_SNIPPETS = 10;
/** Matches `curatedProductKey`'s fallback: a key is never empty. */
const FALLBACK_KEY = "product";

const L1_SLUGS = new Set<string>(L1_CATEGORIES.map((category) => category.slug));

/**
 * `strict: true` requires every property in `required`, so the nullable fields
 * are typed as unions rather than omitted. `openai-client` falls back to
 * `json_object` mode when a model rejects `json_schema`, and the prompt states
 * the same object contract in prose for exactly that path.
 *
 * The top level is an OBJECT with one `products` key: a bare top-level array is
 * an illegal reply under `json_object` and returned an empty object on every
 * call of the DEV-1321 eval. See `NAME_ARBITRATION_SCHEMA`.
 */
const PRODUCTS_SCHEMA = {
  name: "curated_product_proposals",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      products: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name_zh: { type: "string" },
            name_en: { type: ["string", "null"] },
            category: { type: ["string", "null"] },
            subcategories: { type: "array", items: { type: "string" } },
            material: { type: "array", items: { type: "string" } },
            official_url: { type: "string" },
            image_source_url: { type: ["string", "null"] },
            product_description_zh: { type: "string" },
            sources: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  url: { type: "string" },
                  source_type: { type: "string" },
                  claim_zh: { type: ["string", "null"] },
                },
                required: ["url", "source_type", "claim_zh"],
              },
            },
          },
          required: [
            "name_zh",
            "name_en",
            "category",
            "subcategories",
            "material",
            "official_url",
            "image_source_url",
            "product_description_zh",
            "sources",
          ],
        },
      },
    },
    required: ["products"],
  },
} as const;

export type ProductsModelResult = {
  products?: unknown;
};

export type ProductProposalValidationOptions = {
  /** The brand's own site. A product page has to live on it — see `isProductPageUrl`. */
  siteUrl: string;
  max?: number;
};

export type ProductProposalValidation = {
  proposals: CuratedProductProposal[];
  dropped: number;
  /** Per-reason tallies, published on the audit span. */
  dropReasons: Record<string, number>;
};

/**
 * The image tables are reached through the untyped `from` surface, with the row
 * shape asserted at the boundary — the table name is only known at runtime
 * (`brand_images` vs `submission_images`), which the generated union types cannot
 * narrow. Same shape as `FaqSupabase`, for the same reason.
 */
export type ProductsPhaseOptions = {
  brand: EnrichBrand;
  phases: EnrichPhase[];
  scrapedData: EnrichScrapedData | null;
  /** This run's accumulated patch, so a link the earlier phases fixed is the one read. */
  pendingPatch?: EnrichPatch;
  dryRun?: boolean;
  target?: EnrichmentTarget;
  jobId?: string;
  /** Supplier for stored product candidates (brand_images provenance). Injected for testing. */
  loadStoredCandidates?: (submissionId: string) => Promise<ProductCandidate[]>;
  /** Writer for persisting the candidate pool. Injected for testing. */
  candidateWriter?: CandidateWriter;
  /** LLM ranker for scoring gate-passing candidates. Injected for testing. */
  candidateRanker?: LlmRanker;
};

/**
 * `products` is not a `brands` column, which is exactly why the phase refuses to
 * run for a brand target — see the gate in `runProductsPhase`. It reaches
 * `enriched_data.products[]` through `mergeSubmissionEnrichedData`, whose
 * replace-not-union branch keeps a rerun from appending to the stored list.
 *
 * Module-private on purpose: `ProductsPhaseOutput.patch` is the only reference,
 * and an exported alias nobody imports is dead public surface.
 */
type ProductsPhasePatch = EnrichPatch & {
  products?: CuratedProductProposal[];
};

export type ProductsPhaseOutput = {
  phaseResult: PhaseResult;
  patch: ProductsPhasePatch;
  proposals: CuratedProductProposal[];
};

/**
 * THE PHASE PRODUCED NO ANSWER, so it has no opinion about the stored list.
 *
 * `patch: {}` is load-bearing rather than incidental: the replace-not-union
 * branch of `mergeSubmissionEnrichedData` is gated on the patch CARRYING the
 * `products` key, so an empty patch leaves the previous run's proposals exactly
 * where they were. That is right here and on the provider-failure path — a
 * transient 429 must never destroy good proposals — and wrong for a run that
 * answered with nothing, which emits `products: []` instead. See the patch at
 * the end of `runProductsPhase` for that third case.
 */
function skipped(detail: string): ProductsPhaseOutput {
  return {
    phaseResult: buildPhaseResult(
      "products",
      "skipped",
      [],
      0,
      undefined,
      detail,
    ),
    patch: {},
    proposals: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * http(s) only. `new URL` parses `javascript:alert(1)` happily and these values
 * are rendered as hrefs on a public brand page, so the protocol bar is the whole
 * point of the check — the same reason `httpUrlSchema` exists on the write path.
 */
function httpUrl(value: unknown): URL | null {
  const raw = trimmedString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function bareHost(url: URL): string {
  return url.hostname.replace(/^www\./u, "").toLowerCase();
}

/**
 * A product page is a non-root path on the brand's own host.
 *
 * KNOWN CEILING (deliberate): the host comparison is exact after stripping
 * `www.`, so a brand whose shop sits on a different host from its
 * `purchase_website` — a `shop.` subdomain, or a hosted-store platform domain —
 * has its proposals dropped rather than published against the wrong link. That
 * fails closed: a moderator sees zero proposals instead of a product pointing at
 * a stranger's shop. Upgrade path if that costs real coverage: compare the
 * registrable domain, or accept the hosts the links phase resolved as
 * brand-owned (which is the set site-identity has already arbitrated).
 */
function isProductPageUrl(candidate: URL, site: URL): boolean {
  if (bareHost(candidate) !== bareHost(site)) return false;
  return candidate.pathname.replace(/\/+$/u, "").length > 0;
}

function validateSource(raw: unknown): CuratedProductProposalSource | null {
  if (!isRecord(raw)) return null;
  const rawType = trimmedString(raw.source_type);
  // The URL is the load-bearing half of a citation and the `source_type` CHECK
  // list is not something a model can be trusted to spell, so an unknown type is
  // filed as `other` rather than costing the evidence.
  const sourceType =
    rawType && (CURATED_PRODUCT_SOURCE_TYPES as readonly string[]).includes(rawType)
      ? rawType
      : "other";
  const claimZh = trimmedString(raw.claim_zh);
  const parsed = curatedProductSourceSchema.safeParse({
    url: trimmedString(raw.url) ?? "",
    sourceType,
    ...(claimZh ? { claimZh } : {}),
  });
  if (!parsed.success) return null;
  return {
    url: parsed.data.url,
    sourceType: parsed.data.sourceType,
    ...(parsed.data.claimZh ? { claimZh: parsed.data.claimZh } : {}),
  };
}

/**
 * Slugs of the closed `MATERIALS` vocabulary, and nothing else.
 *
 * A Chinese label is DROPPED rather than resolved, even though the ontology
 * could resolve it: `createCuratedProduct` normalises material by slug only and
 * drops a label silently, and the prompt tells the model in as many words that a
 * label will be dropped. Repairing it here would make the prompt's own contract
 * a lie and hide the drift the next eval needs to see.
 *
 * CASE AND PADDING ARE NOT DRIFT, and the write path never treated them as
 * such: `normalizeCuratedMaterials` looks the slug up after
 * `.trim().toLowerCase()`, so `["Ceramic","Wood"]` — an ordinary shape for a
 * model asked for English slugs — is accepted by `createCuratedProduct` and was
 * silently dropped here, storing `material: []` with nothing in the audit to
 * show for it. The lookup is folded the same way so both paths accept the same
 * set. A Chinese label still resolves on neither.
 */
function resolveMaterials(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const slugs: string[] = [];
  for (const value of raw) {
    const candidate = trimmedString(value)?.toLowerCase();
    const material = candidate ? materialBySlug(candidate) : null;
    if (!material) continue;
    if (slugs.includes(material.slug)) continue;
    slugs.push(material.slug);
    if (slugs.length === MAX_MATERIALS_PER_PRODUCT) break;
  }
  return slugs;
}

/**
 * Subcategories arrive as ontology slugs or as the Chinese labels the prompt's
 * vocabulary block lists, so both are folded to slugs — `curated_products.subcategories`
 * is a slug column, and a label stored there renders as a dead filter. A
 * subcategory belonging to another L1 branch is dropped for the same reason
 * `normalizeCuratedSubcategories` drops it: it would never match the product's
 * own category.
 *
 * The slug half of the lookup is folded to lower case for the same reason
 * `resolveMaterials` folds its own: `matchSubcategory` normalises case itself,
 * but it matches LABELS, and `subcategoryBySlug` does not fold anything — so
 * `"Home-Fragrance"` resolved through neither and was lost.
 */
function resolveSubcategories(raw: unknown, category: string): string[] {
  if (!Array.isArray(raw)) return [];
  const slugs: string[] = [];
  for (const value of raw) {
    const candidate = trimmedString(value);
    if (!candidate) continue;
    const subcategory =
      subcategoryBySlug(candidate.toLowerCase()) ?? matchSubcategory(candidate);
    if (!subcategory || subcategory.category !== category) continue;
    if (slugs.includes(subcategory.slug)) continue;
    slugs.push(subcategory.slug);
    if (slugs.length === MAX_SUBCATEGORIES_PER_PRODUCT) break;
  }
  return slugs;
}

/**
 * Derived, never asked for: `createCuratedProduct` builds the stored key the same
 * way (`generateSlug(nameZh)`), so deriving it here keeps the proposal and the
 * row it becomes on the same key. Suffixed rather than deduped on collision —
 * two products of one brand sharing a transliterated name is ordinary, and
 * dropping the second would lose a real product.
 */
function proposalKey(
  nameZh: string,
  nameEn: string | null,
  taken: Set<string>,
  max: number,
): string {
  const base = generateSlug(nameZh) || generateSlug(nameEn ?? "") || FALLBACK_KEY;
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  // Bounded by the CALLER'S cap, never by the module constant. At most `max`
  // proposals are accepted, so of the `max + 1` candidates below one is always
  // free. Pinned to `MAX_PROPOSALS` the loop instead ran out the moment a caller
  // raised `max`, and fell through to an unchecked `${base}-${taken.size + 1}` —
  // a duplicate key from the one function whose job is to prevent duplicates.
  for (let suffix = 2; suffix <= max + 1; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    return candidate;
  }
  // Unreachable by the count above. Thrown rather than papered over with a key
  // that was never checked: a colliding key becomes a second `curated_products`
  // row under a name that already exists, and that is not worth hiding.
  throw new Error(`products: no free proposal key for "${base}"`);
}

/**
 * The whole accept/drop decision, exported so it can be tested without a
 * Supabase client or a live model — the same call `validateFaqEntries` makes,
 * for the same reason (`scripts/check-test-boundaries.mjs` forbids mocking
 * either one).
 */
export function validateProductProposals(
  result: ProductsModelResult,
  options: ProductProposalValidationOptions,
): ProductProposalValidation {
  const max = options.max ?? MAX_PROPOSALS;
  const site = httpUrl(options.siteUrl);
  const proposals: CuratedProductProposal[] = [];
  const dropReasons: Record<string, number> = {};
  const takenKeys = new Set<string>();
  let dropped = 0;

  const drop = (reason: string): void => {
    dropped += 1;
    dropReasons[reason] = (dropReasons[reason] ?? 0) + 1;
  };

  for (const raw of Array.isArray(result.products) ? result.products : []) {
    if (proposals.length >= max) {
      drop("over_cap");
      continue;
    }
    if (!isRecord(raw)) {
      drop("not_an_object");
      continue;
    }

    const nameZh = trimmedString(raw.name_zh);
    if (!nameZh) {
      drop("no_name");
      continue;
    }
    // A category is not repairable from anything else on the proposal, and
    // `curated_products.category` carries the same closed CHECK list, so a
    // proposal without one can never be materialized.
    const category = trimmedString(raw.category);
    if (!category || !L1_SLUGS.has(category)) {
      drop("category_outside_ontology");
      continue;
    }
    const officialUrl = httpUrl(raw.official_url);
    if (!officialUrl || !site || !isProductPageUrl(officialUrl, site)) {
      drop("official_url_is_not_a_product_page");
      continue;
    }
    const productDescriptionZh = trimmedString(raw.product_description_zh);
    // Length band is NOT enforced: the column is NOT NULL and the moderator
    // edits the text before it publishes, so a short description is a note to
    // fix rather than a reason to lose the product. The ceiling is the column's.
    if (!productDescriptionZh || productDescriptionZh.length > MAX_NOTE) {
      drop("no_usable_description");
      continue;
    }
    const sources = (Array.isArray(raw.sources) ? raw.sources : [])
      .map(validateSource)
      .filter((source): source is CuratedProductProposalSource => source !== null)
      .slice(0, MAX_SOURCES_PER_PRODUCT);
    // Never back-filled from `official_url`. A source is the page the fact was
    // read on, and manufacturing that citation is precisely what this drop
    // exists to prevent — selection first, verification second, but never
    // verification invented.
    if (sources.length === 0) {
      drop("no_source_url");
      continue;
    }

    const nameEn = trimmedString(raw.name_en);
    // HOST-GATED like `official_url`, then CLEARED rather than fatal.
    // `imageSourceUrl` exists so usage rights stay re-checkable, and a
    // provenance URL on a host the brand does not own records a permission the
    // brand cannot give — `materialize.ts` forwards the value into the row
    // verbatim and nothing re-checks it later. A `httpUrl()` protocol bar was
    // the only gate, so a Pinterest pin was stored as provenance.
    //
    // The gate is HOST EQUALITY ALONE, not the whole of `isProductPageUrl`: an
    // image legitimately comes from a page that is not a product page — the
    // `classify_images` candidates this phase hands the model include the
    // brand's own homepage — so the non-root-path half would clear provenance
    // the phase itself proposed. The host half is what a stranger's shop fails.
    //
    // A failing URL CLEARS THE FIELD instead of dropping the proposal. That is
    // the reversible choice: the product is still a good proposal, the
    // moderator can paste the right page, and losing a real product over one
    // optional citation costs more than it saves.
    const imageSource = httpUrl(raw.image_source_url);
    const imageSourceUrl =
      imageSource && site && bareHost(imageSource) === bareHost(site)
        ? imageSource.toString()
        : null;

    const key = proposalKey(nameZh, nameEn, takenKeys, max);
    const proposal: CuratedProductProposal = {
      key,
      nameZh,
      ...(nameEn ? { nameEn } : {}),
      category,
      subcategories: resolveSubcategories(raw.subcategories, category),
      material: resolveMaterials(raw.material),
      officialUrl: officialUrl.toString(),
      ...(imageSourceUrl ? { imageSourceUrl } : {}),
      productDescriptionZh,
      sources,
    };
    // THE BOUNDARY SCHEMA IS THE BOUND, re-checked here rather than re-typed:
    // `adminReviewSchema` parses the whole stored list on every save from EVERY
    // section of the review, so one proposal outside those bounds — an unbounded
    // name, a 3 kB URL, a key `generateSlug` transliterated past 200 characters —
    // locks the reviewer out of saving anything at all, behind a generic
    // "Invalid submission review" that names no field. A proposal that cannot be
    // saved must never be stored. Same call `validateSource` already makes
    // against `curatedProductSourceSchema`, one level up.
    if (!curatedProductProposalSchema.safeParse(proposal).success) {
      // The key was reserved to build the candidate; a dropped candidate hands
      // it back so the next proposal is not needlessly suffixed.
      takenKeys.delete(key);
      drop("outside_payload_bounds");
      continue;
    }
    proposals.push(proposal);
  }

  return { proposals, dropped, dropReasons };
}

function scrapedImagePages(
  site: URL,
  scrapedData: EnrichScrapedData | null,
): string[] {
  const sources = scrapedData?.imageSources ?? [];
  const pages: string[] = [];
  for (const source of sources) {
    const parsed = httpUrl(source?.pageUrl);
    if (!parsed || bareHost(parsed) !== bareHost(site)) continue;
    const line = `- ${source.url} | ${source.pageUrl}`;
    if (pages.includes(line)) continue;
    pages.push(line);
    if (pages.length === MAX_IMAGE_CANDIDATES) break;
  }
  return pages;
}

function buildProductsUserContent(
  brand: EnrichBrand,
  site: URL,
  scrapedData: EnrichScrapedData | null,
  pages: string[],
  imageLines: string[],
  listingLines?: string[],
): string {
  const siteUrl = site.toString();
  const content = buildEnrichmentUserContent(
    brand.name ?? brand.slug,
    scrapedData?.description ?? brand.description ?? null,
    (scrapedData?.snippets ?? []).slice(0, MAX_SNIPPETS),
    null,
    {
      links: { purchaseWebsite: siteUrl },
      productCategoryZh: categoryLabelZh(brand.category),
    },
  );
  const blocks = [
    PRODUCTS_LABELS.userPreamble,
    "",
    content.userContent,
    "",
    `${PRODUCTS_LABELS.siteUrl}${siteUrl}`,
  ];
  if (pages.length > 0) {
    blocks.push("", PRODUCTS_LABELS.candidatePages, ...pages);
  }
  if (imageLines.length > 0) {
    blocks.push("", PRODUCTS_LABELS.imageCandidates, ...imageLines);
  }
  // Listing entry points: context only — these are catalog/collection pages
  // the brand uses to organize products. They must NEVER be returned as
  // `official_url` on a proposal; `isProductPageUrl` enforces a non-root
  // path on the brand's own host, but a listing page passes that gate, so
  // the model needs to know their role is navigation context, not evidence.
  if (listingLines && listingLines.length > 0) {
    blocks.push(
      "",
      PRODUCTS_LABELS.listingEntryPoints,
      ...listingLines,
    );
  }
  return blocks.join("\n");
}

type ProductsRunOutcome = {
  proposals: CuratedProductProposal[];
  dropped: number;
  dropReasons: Record<string, number>;
  calls: LlmCallCounts;
};

export async function runProductsPhase({
  brand,
  phases,
  scrapedData,
  pendingPatch,
  dryRun,
  target,
  jobId,
  loadStoredCandidates: loadStored,
  candidateWriter,
  candidateRanker,
}: ProductsPhaseOptions): Promise<ProductsPhaseOutput> {
  if (!phases.includes("products")) return skipped("products phase not requested");

  const effectiveTarget = target ?? brandTarget(brand.id);
  // Submission targets only, the same shape as `runFaqPhase`'s refusal to touch
  // `brand_faq_entries` for a submission id — and for the mirror-image reason.
  // A proposal is not a row: it rides `enriched_data.products[]` until a
  // moderator ticks the keepers, so its only destination is a submission's blob.
  // A brand-target patch is applied column by column to `brands`, which has no
  // `products` column, so carrying proposals there would fail the whole update
  // with a 42703 and take every other phase's field down with it. `runEnrich`
  // has no brand-target path left anyway (a live brand is refreshed through a
  // refresh submission), so this costs no reachable coverage.
  if (effectiveTarget.type !== "submission")
    return skipped("products phase runs only for submission targets");

  const token = process.env.OPENAI_API_KEY;
  if (!token) return skipped("OPENAI_API_KEY is not configured");

  // Read through the pending patch, so the site this run resolved (or REVOKED)
  // is the one asked about: a `purchase_website` site-identity struck as
  // contaminated must never be scraped for products.
  const siteUrl = preferPatched(
    pendingPatch,
    brand.purchase_website ?? brand.purchaseWebsite,
    "purchase_website",
  );
  const site = httpUrl(siteUrl);
  if (!site) return skipped("no official site to propose products from");

  // --- Build the merged candidate pool ---
  // Stored candidates from brand_images provenance (injected supplier).
  const loader = loadStored ?? defaultLoadStoredCandidates;
  const storedCandidates = await loader(effectiveTarget.id);

  // Build a unified pool of ProductCandidate entries from the scraped pages.
  // The scraped half is converted to ProductCandidate shape for mergeCandidatePool.
  const scrapedCandidates: ProductCandidate[] = [];
  const perSourceText = scrapedData?.perSourceText ?? {};
  for (const [url, text] of Object.entries(perSourceText)) {
    const parsed = httpUrl(url);
    if (!parsed || bareHost(parsed) !== bareHost(site)) continue;
    const normalizedUrl = normalizeProductUrl(url);
    if (!normalizedUrl) continue;
    scrapedCandidates.push({
      url,
      normalizedUrl,
      title: text?.title ?? undefined,
      supplier: "scraped",
      urlClass: classifyProductUrl(url),
    });
  }

  const pool = mergeCandidatePool([...storedCandidates, ...scrapedCandidates]);

  // Format the product bucket as user-content lines, keeping the same-host
  // filter and PAGE_TEXT_LIMIT truncation the scraped path always had.
  const pages: string[] = [];
  for (const candidate of pool.products.slice(0, MAX_CANDIDATE_PAGES)) {
    const text = perSourceText[candidate.url];
    const evidence = [text?.title ?? candidate.title, text?.description, text?.story]
      .map((v) => trimmedString(v))
      .filter((v): v is string => v !== null)
      .join(" / ")
      .slice(0, PAGE_TEXT_LIMIT);
    pages.push(evidence ? `- ${candidate.url} | ${evidence}` : `- ${candidate.url}`);
  }

  // Listing entry points — context only, must NEVER be returned as `official_url`.
  const listingLines: string[] = [];
  for (const candidate of pool.listings) {
    const text = perSourceText[candidate.url];
    const evidence = [text?.title ?? candidate.title, text?.description]
      .map((v) => trimmedString(v))
      .filter((v): v is string => v !== null)
      .join(" / ")
      .slice(0, PAGE_TEXT_LIMIT);
    listingLines.push(evidence ? `- ${candidate.url} | ${evidence}` : `- ${candidate.url}`);
  }

  // FAILS CLOSED ON AN EMPTY POOL. The products phase requires at least one
  // product-detail candidate — from scraped pages, stored provenance, or both.
  // Without candidates the model is asked to pick product pages while being
  // shown none, and nothing downstream can catch fabricated URLs. Zero
  // proposals beats five fabricated ones.
  if (pages.length === 0)
    return skipped(
      "no product candidates in the merged pool (scraped + stored)",
    );

  return auditedCall(
    { provider: "enrich", operation: "runProductsPhase", kind: "service" },
    async (ctx) => {
      const { result, durationMs } = await timePhase<ProductsRunOutcome>(
        async () => {
          const imageLines = scrapedImagePages(site, scrapedData)
            .slice(0, MAX_IMAGE_CANDIDATES);
          const userContent = buildProductsUserContent(
            brand,
            site,
            scrapedData,
            pages,
            imageLines,
            listingLines,
          );
          const config = buildProfiledEnrichmentConfig(
            "products",
            PRODUCTS_SYSTEM_PROMPT,
            "products",
            { maxProposals: MAX_PROPOSALS },
          );
          const client = createProfiledOpenAIClient(
            "products",
            {
              ...(jobId ? { jobId } : {}),
              target: effectiveTarget,
              phase: "products",
              attempt: 1,
              config,
            },
            { apiKey: token },
          );
          const response = await client.chat({
            system: PRODUCTS_SYSTEM_PROMPT,
            user: userContent,
            schema: PRODUCTS_SCHEMA,
            ...profileChatParams("products"),
          });
          if (!response.response.ok) {
            return {
              proposals: [],
              dropped: 0,
              dropReasons: {},
              calls: { attempted: 1, providerFailed: 1 },
            };
          }
          const parsed = parseJson<ProductsModelResult>(response.content ?? "");
          const validation = validateProductProposals(parsed ?? {}, {
            siteUrl: site.toString(),
          });
          return {
            ...validation,
            calls: { attempted: 1, providerFailed: 0 },
          };
        },
      );

      Object.assign(ctx.summary, {
        productsProposed: result.proposals.length,
        productsDropped: result.dropped,
        productsDropReasons: result.dropReasons,
      });

      // --- Candidate pool persistence (DEV-1610) ---
      // Runs inside the existing audited call; no new audit operation.
      // Persists EVERY candidate (gated-out + ranked) for run-over-run
      // visibility. A write failure is reported but never fails the phase.
      // The default writer appends to `curated_product_candidates`; if the
      // migration is not yet applied, the insert reports an error and the
      // phase continues — designed degradation, not a bug.
      try {
        // Default ranker: search_position as baseline score. The LLM ranking
        // quality is a tracked follow-up (DEV-1612); this baseline uses
        // position as the sole signal so the persistence schema is exercised.
        const ranker: LlmRanker = candidateRanker ?? (async (candidates) =>
          candidates.map((c) => ({
            url: c.url,
            score: c.searchPosition != null ? (100 - c.searchPosition) : 50,
            rationale: "baseline: position-derived score",
          }))
        );

        const writer = candidateWriter ?? createDefaultCandidateWriter();

        const selectionResult = await persistCandidatePool({
          pool: [...storedCandidates, ...scrapedCandidates],
          acceptedCandidates: [],
          ranker,
          writer,
          brandId: brand.id,
          submissionId: effectiveTarget.type === "submission" ? effectiveTarget.id : null,
          jobId: jobId ?? null,
          maxProducts: MAX_PROPOSALS,
        });

        if (selectionResult.persistError) {
          Object.assign(ctx.summary, {
            candidatePersistError: selectionResult.persistError,
          });
        }
        Object.assign(ctx.summary, {
          candidatesGated: selectionResult.gated.length,
          candidatesRanked: selectionResult.ranked.length,
        });
      } catch (err) {
        // The writer or ranker threw (e.g. service client missing in tests,
        // or the table does not exist yet). Report and continue — persistence
        // must never fail the phase.
        Object.assign(ctx.summary, {
          candidatePersistError:
            err instanceof Error ? err.message : String(err),
        });
      }

      if (isLlmProviderFailure(result.calls)) {
        return {
          phaseResult: {
            ...buildPhaseResult(
              "products",
              "failed",
              [],
              durationMs,
              "LLM provider failed the products call",
            ),
            providerFailure: true,
          },
          // NO ANSWER, NO OPINION: an empty patch leaves the previous run's
          // proposals alone. Clearing them on a transient provider error would
          // destroy good proposals over a 429. See `skipped`.
          patch: {},
          proposals: [],
        };
      }

      return {
        phaseResult: buildPhaseResult(
          "products",
          "succeeded",
          result.proposals.length > 0 ? ["products"] : [],
          durationMs,
          undefined,
          `proposed ${result.proposals.length}, dropped ${result.dropped}${
            dryRun === true ? " (dry run — nothing written)" : ""
          }`,
        ),
        // ALWAYS CARRIES THE KEY, empty list included. The phase ran and the
        // model answered, so "nothing qualified" is a verdict about this brand's
        // site — and `mergeSubmissionEnrichedData` only replaces
        // `enriched_data.products` when the patch carries the key. Returning `{}`
        // here left the previous run's proposals in the drawer for a moderator to
        // approve, including proposals mined from a `purchase_website` that
        // `site_identity` has since revoked as contaminated. The no-answer paths
        // (`skipped`, provider failure) keep `{}` for the mirror-image reason.
        //
        // A dry run still reports what it proposed; the patch is never persisted
        // on that path (`runEnrich` skips the persist call), so there is nothing
        // to suppress here and suppressing it would hide the phase's output from
        // the operator the dry run exists for.
        patch: { products: result.proposals },
        proposals: result.proposals,
      };
    },
    { subjectId: brand.id },
  );
}
