import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auditedCall } from "@/lib/audit";
import { PRODUCTS_LABELS, PRODUCTS_SYSTEM_PROMPT } from "@/lib/prompts";
import {
  CATEGORY_LIST,
  SUBCATEGORY_VOCAB_BLOCK,
  MATERIAL_VOCAB_BLOCK,
  TAIWAN_USAGE_RULES,
} from "@/lib/prompts/shared";
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
import { fetchLangfusePrompt } from "@/lib/langfuse/prompt";
import {
  parseAndValidate,
  toStrictJsonSchema,
  formatRetryInstruction,
} from "../_shared/zod-schema";
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
  dedupeNearDuplicates,
  mergeCandidatePool,
  normalizeProductUrl,
  type ProductCandidate,
} from "./product-candidates";
import {
  applyGates,
  createDefaultCandidateWriter,
  persistCandidatePool,
  type CandidateOriginDecision,
  type CandidateWriter,
  type LlmRanker,
} from "../curated-products/candidate-selection";
import {
  assessDeterministicOrigin,
  buildOriginExcerpts,
  decideOriginQualification,
  type LlmOriginAssessment,
  type OriginExcerpt,
  type RegistryOriginAssessment,
} from "../curated-products/origin-qualification";
import {
  lookupExactRegistryProducts,
  type ExactRegistryLookupInput,
  type ExactRegistryLookupResult,
} from "../mit-registry";
import { loadRenderedProductTexts } from "./scraper/product-origin-text";
import { fetchHtmlWithMetadata } from "./scraper/fetch-guards";
import { resolveProfileModel } from "@/lib/constants/llm-models";
import type { RenderProviderWithBudget } from "./scraper/render/from-env";
import type { CatalogDiscoveryResult } from "./catalog-discovery";
import type { CandidateImage } from "./candidate-pool";
import { rankForProduct, type RankableImage } from "./image-ranking";
import { createAgentModel, type AgentModel } from "./agents/runtime";
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
 * The phase writes NO rows. It proposes at most twenty products, the proposals
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

/** The qualified-proposal ceiling after the best-score window is applied. */
const MAX_PROPOSALS = 20;
const MAX_MATERIALS_PER_PRODUCT = 3;
/** A proposal cites its provenance; it does not carry a bibliography. */
const MAX_SOURCES_PER_PRODUCT = 5;
/** Candidate pages and images the user message carries, oldest-first by scrape order. */
const MAX_CANDIDATE_PAGES = 25;
/** Per-page evidence is a title plus a lead, not the whole page. */
const PAGE_TEXT_LIMIT = 240;
const MAX_SNIPPETS = 10;
/** Matches `curatedProductKey`'s fallback: a key is never empty. */
const FALLBACK_KEY = "product";

const L1_SLUGS = new Set<string>(
  L1_CATEGORIES.map((category) => category.slug),
);

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
const productsShape = z.object({
  evaluations: z.array(
    z.object({
      candidate_url: z.string(),
      editorial_score: z.number().int().min(0).max(100),
      editorial_rationale: z.string(),
      made_in_taiwan: z.boolean(),
      materials_from_taiwan: z.boolean(),
      origin_excerpt_ids: z.array(z.string()),
      product_model: z.string().nullable(),
    }),
  ),
  products: z.array(
    z.object({
      name_zh: z.string(),
      name_en: z.string().nullable(),
      category: z.string().nullable(),
      subcategory: z.string().nullable(),
      material: z.array(z.string()),
      official_url: z.string(),
      image_source_url: z.string().nullable(),
      product_description_zh: z.string(),
      sources: z.array(
        z.object({
          url: z.string(),
          source_type: z.string(),
          claim_zh: z.string().nullable(),
        }),
      ),
    }),
  ),
});

const PRODUCTS_SCHEMA = {
  name: "curated_product_proposals",
  schema: toStrictJsonSchema(productsShape),
};

/**
 * The same reply contract, exported for the agent graph.
 *
 * ONE shape, not two. The agent's propose step used to carry a private schema
 * with no `evaluations` key, which meant it had no editorial score to rank the
 * candidate pool with and no citation-guarded `made_in_taiwan` to feed the
 * origin consensus — so `verifyOrigin` had nothing to decide on. Sharing the
 * shape also shares `validateCandidateEvaluations`, which is what refuses an
 * invented excerpt id.
 */
export const PRODUCTS_PROPOSAL_SHAPE = productsShape;

/**
 * Lenient parse shape for `parseAndValidate`: validates only the top-level
 * structure so that individual product/evaluation failures are caught downstream
 * by `validateProductProposals` rather than rejecting the entire response.
 */
const productsParseShape = z.object({
  evaluations: z.array(z.unknown()).optional(),
  products: z.array(z.unknown()),
});

export type ProductsModelResult = {
  evaluations?: unknown;
  products?: unknown;
};

export type ProductCandidateEvaluation = {
  url: string;
  score: number | null;
  rationale: string | null;
  productModel: string | null;
  llmOrigin: LlmOriginAssessment;
};

export type ProductProposalValidationOptions = {
  /** Kept for prompt/backward compatibility; exact candidates own acceptance. */
  siteUrl: string;
  max?: number;
  candidates?: readonly ProductCandidate[];
};

export type ProductProposalValidation = {
  proposals: CuratedProductProposal[];
  dropped: number;
  /** Per-reason tallies, published on the audit span. */
  dropReasons: Record<string, number>;
  /** Total items the model returned, before validation. `rawCount === proposals.length + dropped`. */
  rawCount: number;
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
  /** Writer for persisting the candidate pool. Injected for testing. */
  candidateWriter?: CandidateWriter;
  /** LLM ranker for scoring gate-passing candidates. Injected for testing. */
  candidateRanker?: LlmRanker;
  loadOriginTexts?: (urls: readonly string[]) => Promise<Map<string, string>>;
  lookupRegistryProducts?: (
    inputs: readonly ExactRegistryLookupInput[],
  ) => Promise<Map<string, ExactRegistryLookupResult>>;
  /** Catalog result from the images phase. Optional until the orchestrator is updated (Task 5). */
  catalogResult?: CatalogDiscoveryResult;
  /** Page URLs from image acquisition candidates. Optional until the orchestrator is updated (Task 5). */
  acquisitionPageUrls?: string[];
  /** Classified image pool from the acquire phase, for product-level image selection. */
  imagePool?: RankableImage[];
  renderProvider?: RenderProviderWithBudget;
  /**
   * Chat model for the agent path. Injected only by tests; production builds
   * one from the `products_agent` profile through the shared agent runtime.
   */
  agentModel?: AgentModel;
  /** Stores product-page images for decision #35. Injected for testing. */
  storePageImages?: (
    candidates: CandidateImage[],
  ) => Promise<(string | null)[]>;
  /** Classifies exactly the images decision #35 just stored. Injected for testing. */
  classifyPageImages?: (handles: string[]) => Promise<RankableImage[]>;
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

export function validateCandidateEvaluations(
  result: ProductsModelResult,
  candidates: readonly ProductCandidate[],
  excerptsByUrl: ReadonlyMap<string, readonly OriginExcerpt[]>,
): Map<string, ProductCandidateEvaluation> {
  const rawByUrl = new Map<string, Record<string, unknown>>();
  for (const raw of Array.isArray(result.evaluations)
    ? result.evaluations
    : []) {
    if (!isRecord(raw)) continue;
    const normalized = normalizeProductUrl(
      trimmedString(raw.candidate_url) ?? "",
    );
    if (normalized && !rawByUrl.has(normalized)) rawByUrl.set(normalized, raw);
  }

  const evaluations = new Map<string, ProductCandidateEvaluation>();
  for (const candidate of candidates) {
    const raw = rawByUrl.get(candidate.normalizedUrl);
    const excerpts = excerptsByUrl.get(candidate.url) ?? [];
    const allowedIds = new Set(excerpts.map((excerpt) => excerpt.id));
    const citedIds = Array.isArray(raw?.origin_excerpt_ids)
      ? raw.origin_excerpt_ids.filter(
          (value): value is string =>
            typeof value === "string" && allowedIds.has(value),
        )
      : [];
    const allCitationsValid =
      citedIds.length > 0 &&
      Array.isArray(raw?.origin_excerpt_ids) &&
      citedIds.length === raw.origin_excerpt_ids.length;
    const score = raw?.editorial_score;
    const validScore =
      typeof score === "number" &&
      Number.isInteger(score) &&
      score >= 0 &&
      score <= 100
        ? score
        : null;
    const rationale = trimmedString(raw?.editorial_rationale);
    const madeInTaiwan = allCitationsValid && raw?.made_in_taiwan === true;
    const materialsFromTaiwan =
      allCitationsValid && raw?.materials_from_taiwan === true;

    evaluations.set(candidate.url, {
      url: candidate.url,
      score: validScore !== null && rationale ? validScore : null,
      rationale: validScore !== null && rationale ? rationale : null,
      productModel: trimmedString(raw?.product_model),
      llmOrigin: {
        madeInTaiwan,
        materialsFromTaiwan,
        excerptIds: citedIds,
      },
    });
  }
  return evaluations;
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
    rawType &&
    (CURATED_PRODUCT_SOURCE_TYPES as readonly string[]).includes(rawType)
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
 * The subcategory arrives as an ontology slug or as a Chinese label from the
 * prompt's vocabulary block, so either form is folded to the scalar slug. A
 * subcategory belonging to another L1 branch is dropped because it would never
 * match the product's own category.
 *
 * The slug half of the lookup is folded to lower case for the same reason
 * `resolveMaterials` folds its own: `matchSubcategory` normalises case itself,
 * but it matches LABELS, and `subcategoryBySlug` does not fold anything — so
 * `"Home-Fragrance"` resolved through neither and was lost.
 */
function resolveSubcategory(raw: unknown, category: string): string | null {
  const candidate = trimmedString(raw);
  if (!candidate) return null;
  const subcategory =
    subcategoryBySlug(candidate.toLowerCase()) ?? matchSubcategory(candidate);
  return subcategory?.category === category ? subcategory.slug : null;
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
  const base =
    generateSlug(nameZh) || generateSlug(nameEn ?? "") || FALLBACK_KEY;
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
  const candidateByUrl = new Map(
    (options.candidates ?? []).map((candidate) => [
      candidate.normalizedUrl,
      candidate,
    ]),
  );
  const proposals: CuratedProductProposal[] = [];
  const dropReasons: Record<string, number> = {};
  const takenKeys = new Set<string>();
  let dropped = 0;

  const items = Array.isArray(result.products) ? result.products : [];
  const rawCount = items.length;

  const drop = (reason: string): void => {
    dropped += 1;
    dropReasons[reason] = (dropReasons[reason] ?? 0) + 1;
  };

  for (const raw of items) {
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
    const normalizedOfficialUrl = officialUrl
      ? normalizeProductUrl(officialUrl.toString())
      : null;
    const ownedCandidate = normalizedOfficialUrl
      ? candidateByUrl.get(normalizedOfficialUrl)
      : undefined;
    if (
      !officialUrl ||
      !site ||
      (candidateByUrl.size > 0
        ? !ownedCandidate
        : !isProductPageUrl(officialUrl, site))
    ) {
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
      .filter(
        (source): source is CuratedProductProposalSource => source !== null,
      )
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
    // THE MODEL'S `image_source_url` IS NEVER USED (decision #35). The field
    // stays in the schema — removing it would make the model improvise a home
    // for the value — but the only image a proposal may carry is one this
    // pipeline saw: the candidate's own thumbnail here, upgraded in
    // `publishProposals` to a classified keep from the product's own page when
    // the image pool has one. The model echoing a URL is not evidence that the
    // URL is an image, that the brand owns it, or that it depicts this product.
    const imageSourceUrl = ownedCandidate?.imageUrl ?? null;

    const key = proposalKey(nameZh, nameEn, takenKeys, max);
    const proposal: CuratedProductProposal = {
      key,
      nameZh,
      ...(nameEn ? { nameEn } : {}),
      category,
      subcategory: resolveSubcategory(raw.subcategory, category),
      material: resolveMaterials(raw.material),
      officialUrl: officialUrl.toString(),
      ...(imageSourceUrl ? { imageSourceUrl } : {}),
      productDescriptionZh,
      sources,
      madeInTaiwanConfirmed: false,
      materialsFromTaiwanConfirmed: false,
      mitRegistryId: null,
      originCandidateId: null,
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

  return { proposals, dropped, dropReasons, rawCount };
}

function buildProductsUserContent(
  brand: EnrichBrand,
  site: URL,
  scrapedData: EnrichScrapedData | null,
  pages: string[],
  listingLines?: string[],
  originLines?: string[],
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
  // Listing entry points: context only — these are catalog/collection pages
  // the brand uses to organize products. They must NEVER be returned as
  // `official_url` on a proposal; `isProductPageUrl` enforces a non-root
  // path on the brand's own host, but a listing page passes that gate, so
  // the model needs to know their role is navigation context, not evidence.
  if (listingLines && listingLines.length > 0) {
    blocks.push("", PRODUCTS_LABELS.listingEntryPoints, ...listingLines);
  }
  if (originLines && originLines.length > 0) {
    blocks.push("", PRODUCTS_LABELS.originExcerpts, ...originLines);
  }
  return blocks.join("\n");
}

type ProductsRunOutcome = {
  proposals: CuratedProductProposal[];
  dropped: number;
  dropReasons: Record<string, number>;
  rawCount: number;
  calls: LlmCallCounts;
  evaluations: Map<string, ProductCandidateEvaluation>;
  originDecisions: Map<string, CandidateOriginDecision>;
  candidateIdsByUrl: Map<string, string>;
};

type PublishProposalsOptions = {
  proposals: CuratedProductProposal[];
  /** Every candidate seen this run, gated or not — the provenance trail. */
  catalogCandidates: ProductCandidate[];
  evaluations: ReadonlyMap<string, ProductCandidateEvaluation>;
  originDecisions: ReadonlyMap<string, CandidateOriginDecision>;
  candidateIdsByUrl: ReadonlyMap<string, string>;
  ownedHosts: string[];
  brandId: string;
  submissionId: string | null;
  jobId: string | null;
  collapsedCount: number;
  candidateWriter?: CandidateWriter;
  candidateRanker?: LlmRanker;
  /**
   * Classified images to pick each product's own image from. Empty on a run
   * with no acquire pool, which downgrades the image to `unverified` rather
   * than inventing one.
   */
  imagePool: readonly RankableImage[];
  summary: Record<string, unknown>;
};

/**
 * Turns verified proposals into the list the moderator sees.
 *
 * THE ONLY CALLER OF `persistCandidatePool`, and the only place a proposal
 * gains `madeInTaiwanConfirmed` / `originCandidateId`. It was previously inline
 * in the single-call body, so the agent path returned early and shipped
 * proposals with no candidate provenance rows and no Made-in-Taiwan
 * confirmation at all (DEV-1644 F6). Both paths call this now.
 *
 * Three things happen here, in this order because each depends on the last:
 *   1. every candidate is persisted, which is what mints the audit ids;
 *   2. proposals outside the ranked selection window are dropped;
 *   3. the survivors are stamped with origin qualification and a product image.
 *
 * A persistence failure is reported on the summary and never fails the phase —
 * the proposals are still good, they just lose their provenance rows.
 */
async function publishProposals(
  options: PublishProposalsOptions,
): Promise<CuratedProductProposal[]> {
  const {
    proposals,
    catalogCandidates,
    evaluations,
    originDecisions,
    candidateIdsByUrl,
    ownedHosts,
    brandId,
    submissionId,
    jobId,
    collapsedCount,
    imagePool,
    summary,
  } = options;

  /**
   * Decision #35: the product image is a classified keep from the product's OWN
   * page. `rankForProduct` filters the pool by the page each image was found on,
   * so a hit is proof this pipeline saw the image on this product's page. The
   * candidate thumbnail off a listing grid is the fallback and is recorded as
   * `unverified`; the model's `image_source_url` is never a source at all.
   */
  const withImage = (
    proposal: CuratedProductProposal,
  ): { proposal: CuratedProductProposal; status: "verified" | "unverified" | "missing" } => {
    const ranked =
      imagePool.length > 0
        ? rankForProduct(imagePool, proposal.officialUrl)
        : null;
    const rankedUrl = ranked?.imageUrl ?? null;
    if (rankedUrl) {
      return { proposal: { ...proposal, imageSourceUrl: rankedUrl }, status: "verified" };
    }
    return {
      proposal,
      status: proposal.imageSourceUrl ? "unverified" : "missing",
    };
  };

  const stampImages = (
    list: CuratedProductProposal[],
  ): CuratedProductProposal[] => {
    const counts = { verified: 0, unverified: 0, missing: 0 };
    const stamped = list.map((proposal) => {
      const result = withImage(proposal);
      counts[result.status] += 1;
      return result.proposal;
    });
    Object.assign(summary, { productImageStatus: counts });
    return stamped;
  };

  try {
    const ranker: LlmRanker =
      options.candidateRanker ??
      (async (candidates) =>
        candidates.map((candidate) => ({
          url: candidate.url,
          score: evaluations.get(candidate.url)?.score ?? null,
          rationale: evaluations.get(candidate.url)?.rationale ?? null,
        })));

    const writer = options.candidateWriter ?? createDefaultCandidateWriter();

    // Persists EVERY candidate — including off-host and duplicates — so the
    // full provenance trail is recorded for run-over-run visibility. The
    // deduped, host-filtered pool is only for the LLM prompt.
    const selectionResult = await persistCandidatePool({
      pool: catalogCandidates,
      acceptedCandidates: [],
      ranker,
      writer,
      brandId,
      submissionId,
      jobId,
      maxProducts: MAX_PROPOSALS,
      originDecisions,
      candidateIdsByUrl,
      officialHost: ownedHosts,
    });

    const selectedUrls = new Set(
      selectionResult.ranked.map((candidate) => candidate.normalizedUrl),
    );
    const published = proposals
      .filter((proposal) => {
        const normalized = normalizeProductUrl(proposal.officialUrl);
        return normalized !== null && selectedUrls.has(normalized);
      })
      .map((proposal) => {
        const normalized = normalizeProductUrl(proposal.officialUrl);
        const candidate = [...originDecisions.keys()].find(
          (url) => normalizeProductUrl(url) === normalized,
        );
        if (!candidate) return proposal;
        const auditId = selectionResult.auditIdsByUrl.get(candidate);
        const decision = originDecisions.get(candidate);
        if (!auditId || !decision?.mitQualified) return proposal;
        return {
          ...proposal,
          madeInTaiwanConfirmed: true,
          materialsFromTaiwanConfirmed:
            decision.qualificationMethod === "consensus",
          mitRegistryId:
            decision.qualificationMethod === "registry" &&
            typeof decision.registry.recordId === "number"
              ? decision.registry.recordId
              : null,
          originCandidateId: auditId,
        };
      });

    if (selectionResult.persistError) {
      Object.assign(summary, {
        candidatePersistError: selectionResult.persistError,
      });
    }
    Object.assign(summary, {
      candidatesCollapsed: collapsedCount,
      candidatesGated: selectionResult.gated.length,
      candidateBestScore: selectionResult.bestScore,
      candidateCutoff: selectionResult.cutoff,
      candidatesEvaluated: selectionResult.evaluatedCount,
      candidatesInvalidOrMissing: selectionResult.invalidOrMissingCount,
      candidatesBelowWindow: selectionResult.belowWindowCount,
      candidatesSelected: selectionResult.ranked.length,
      proposalYield:
        catalogCandidates.length - selectionResult.gated.length > 0
          ? published.length /
            (catalogCandidates.length - selectionResult.gated.length)
          : 0,
    });

    return stampImages(published);
  } catch (err) {
    // The writer or ranker threw (e.g. service client missing in tests, or the
    // table does not exist yet). Report and continue — persistence must never
    // fail the phase, and the proposals themselves are unaffected.
    Object.assign(summary, {
      candidatePersistError: err instanceof Error ? err.message : String(err),
    });
    return stampImages(proposals);
  }
}

export async function runProductsPhase({
  brand,
  phases,
  scrapedData,
  pendingPatch,
  dryRun,
  target,
  jobId,
  candidateWriter,
  candidateRanker,
  loadOriginTexts,
  lookupRegistryProducts,
  catalogResult,
  acquisitionPageUrls,
  imagePool: acquireImagePool,
  renderProvider,
  agentModel,
  storePageImages,
  classifyPageImages,
}: ProductsPhaseOptions): Promise<ProductsPhaseOutput> {
  if (!phases.includes("products"))
    return skipped("products phase not requested");

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
  const channelUrls = [
    ...new Set(
      [
        siteUrl,
        brand.purchase_pinkoi,
        brand.purchase_shopee,
        brand.purchase_myship,
      ].filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      ),
    ),
  ];
  const site = httpUrl(channelUrls[0]);
  if (!site)
    return skipped("no verified purchase channel to propose products from");

  // Catalog discovery now runs in the images phase (DEV-1633). The products
  // phase receives the result as an input. Fall back to empty when the
  // orchestrator hasn't been updated yet (Task 5).
  const catalog: CatalogDiscoveryResult = catalogResult ?? {
    triples: [],
    attempts: [],
    evidence: new Map(),
  };

  // --- Build the merged candidate pool ---
  const ownedHosts = new Set(
    channelUrls
      .map((url) => httpUrl(url))
      .filter((url): url is URL => url !== null)
      .map(bareHost),
  );
  const marketplaceHosts = new Set(
    [brand.purchase_pinkoi, brand.purchase_shopee, brand.purchase_myship]
      .map((url) => httpUrl(url))
      .filter((url): url is URL => url !== null)
      .map(bareHost),
  );
  const catalogOwnedUrls = new Set(
    catalog.triples.map((triple) => normalizeProductUrl(triple.url)),
  );
  const isOwnedCandidate = (url: string): boolean => {
    const parsed = httpUrl(url);
    const normalized = normalizeProductUrl(url);
    if (!parsed || !normalized || !ownedHosts.has(bareHost(parsed)))
      return false;
    return (
      !marketplaceHosts.has(bareHost(parsed)) ||
      catalogOwnedUrls.has(normalized)
    );
  };
  // Build a unified pool of ProductCandidate entries from the scraped pages.
  // The scraped half is converted to ProductCandidate shape for mergeCandidatePool.
  const imageByPage = new Map<string, string>();
  for (const source of scrapedData?.imageSources ?? []) {
    if (source.pageUrl && source.url && !imageByPage.has(source.pageUrl)) {
      imageByPage.set(source.pageUrl, source.url);
    }
  }

  const scrapedCandidates: ProductCandidate[] = [];
  const perSourceText = scrapedData?.perSourceText ?? {};
  let scrapedIndex = 0;
  for (const [url, text] of Object.entries(perSourceText)) {
    if (!isOwnedCandidate(url)) continue;
    const normalizedUrl = normalizeProductUrl(url);
    if (!normalizedUrl) continue;
    scrapedCandidates.push({
      url,
      normalizedUrl,
      title: text?.title ?? undefined,
      supplier: "scraped",
      urlClass: classifyProductUrl(url),
      imageUrl: imageByPage.get(url),
      searchPosition: scrapedIndex++,
    });
  }

  // Acquisition candidates from the images phase (DEV-1633): page URLs
  // discovered during image acquisition that may contain product pages.
  const acquisitionCandidates: ProductCandidate[] = [];
  for (const [index, url] of (acquisitionPageUrls ?? [])
    .filter(isOwnedCandidate)
    .entries()) {
    const normalizedUrl = normalizeProductUrl(url);
    if (!normalizedUrl) continue;
    acquisitionCandidates.push({
      url,
      normalizedUrl,
      title: undefined,
      supplier: "acquisition",
      urlClass: classifyProductUrl(url),
      imageUrl: undefined,
      searchPosition: index,
    });
  }

  // Dedupe near-duplicates AFTER merging all suppliers. Enumerated candidates are
  // placed first so they win ties: a catalog candidate carries imageUrl and
  // searchPosition that the scraped duplicate lacks, while the scraped text is
  // still available via perSourceText[candidate.url] for user-content assembly.
  const enumeratedCandidates: ProductCandidate[] = catalog.triples.map(
    (triple, index) => ({
      url: triple.url,
      normalizedUrl: normalizeProductUrl(triple.url)!,
      title: triple.title,
      imageUrl: triple.imageUrl,
      supplier: triple.supplier,
      urlClass: "product-detail",
      searchPosition: index,
    }),
  );
  const catalogCandidates = [
    ...enumeratedCandidates,
    ...acquisitionCandidates,
    ...scrapedCandidates,
  ]
    .sort((left, right) => {
      const leftHost = httpUrl(left.url);
      const rightHost = httpUrl(right.url);
      const leftOfficial =
        leftHost !== null && ownedHosts.has(bareHost(leftHost));
      const rightOfficial =
        rightHost !== null && ownedHosts.has(bareHost(rightHost));
      if (leftOfficial !== rightOfficial) return leftOfficial ? -1 : 1;
      return (
        (left.searchPosition ?? Number.MAX_SAFE_INTEGER) -
        (right.searchPosition ?? Number.MAX_SAFE_INTEGER)
      );
    })
    .slice(0, MAX_CANDIDATE_PAGES);
  const catalogUrls = new Set(
    catalogCandidates.map((candidate) => candidate.url),
  );
  const { kept: dedupedCandidates, collapsedCount } = dedupeNearDuplicates(
    [
      ...enumeratedCandidates,
      ...acquisitionCandidates,
      ...scrapedCandidates,
    ].filter((candidate) => catalogUrls.has(candidate.url)),
  );
  const pool = mergeCandidatePool(dedupedCandidates);

  // Format the product bucket as user-content lines, keeping the same-host
  // filter and PAGE_TEXT_LIMIT truncation the scraped path always had.
  const pages: string[] = [];
  for (const candidate of pool.products.slice(0, MAX_CANDIDATE_PAGES)) {
    const catalogEvidence = catalog.evidence.get(candidate.normalizedUrl);
    const text = perSourceText[candidate.url];
    const evidence = [
      catalogEvidence?.title ?? text?.title ?? candidate.title,
      text?.description,
      text?.story,
      catalogEvidence?.text,
    ]
      .map((v) => trimmedString(v))
      .filter((v): v is string => v !== null)
      .join(" / ")
      .slice(0, PAGE_TEXT_LIMIT);
    const imageEvidence = candidate.imageUrl
      ? ` | image: ${candidate.imageUrl}`
      : "";
    pages.push(
      `${evidence ? `- ${candidate.url} | ${evidence}` : `- ${candidate.url}`}${imageEvidence}`,
    );
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
    listingLines.push(
      evidence ? `- ${candidate.url} | ${evidence}` : `- ${candidate.url}`,
    );
  }

  // FAILS CLOSED ON AN EMPTY POOL. The products phase requires at least one
  // product-detail candidate — from scraped pages, stored provenance, or both.
  // Both suppliers are host-filtered (same-host as the brand site) and deduped
  // before reaching this point. Without candidates the model is asked to pick
  // product pages while being shown none, and nothing downstream can catch
  // fabricated URLs. Zero proposals beats twenty fabricated ones.
  if (pages.length === 0)
    return {
      phaseResult: {
        ...buildPhaseResult(
          "products",
          "skipped",
          [],
          0,
          undefined,
          "no product candidates in the merged pool (scraped + stored)",
        ),
        ...(catalog.zeroReason
          ? { catalogZeroReason: catalog.zeroReason }
          : {}),
        productsProposed: 0,
      },
      patch: {},
      proposals: [],
    };

  // ONE set of candidate ids for the whole run. Origin excerpt ids, the MIT
  // registry lookup keys and the persisted `curated_product_candidates` rows all
  // key off these, so minting them twice would make a model's excerpt citation
  // unresolvable against the row it was supposed to justify.
  const candidateIdsByUrl = new Map(
    catalogCandidates.map((candidate) => [candidate.url, randomUUID()]),
  );

  // Per-brand render budgeting. The worker builds ONE provider for its whole
  // life, so a caller that never sets a key leaves every brand sharing the
  // default and turns a per-brand cap of 3 into a per-process cap of 3 (F8).
  renderProvider?.setBrandKey?.(brand.id);

  const loadOriginTextsFn =
    loadOriginTexts ?? ((urls: readonly string[]) =>
      loadRenderedProductTexts(urls, renderProvider));

  return auditedCall(
    { provider: "enrich", operation: "runProductsPhase", kind: "service" },
    async (ctx) => {
      // Why the single-call body ran, when the agent was enabled and did not
      // publish. Without it a fallback run is indistinguishable from a run where
      // the agent was never enabled, and the first staging run could not say why
      // any brand had fallen back.
      let agentFallback: { outcome: PhaseResult["agentOutcome"]; reason: string } | null =
        null;

      // --- Products agent gate (DEV-1644) ---
      // When enabled (default), the multi-step agent runs select → read →
      // propose → verify → repair. A THROWN agent falls back to the single-call
      // body; a `blocked` agent does not (see below).
      if (process.env.PRODUCTS_AGENT !== "off") {
        try {
          const { runProductsAgent } = await import("./products/graph");
          const modelName = resolveProfileModel("products_agent");
          const model =
            agentModel ?? (await createAgentModel("products_agent", { jsonObject: true }));

          // Decision #35, wired to the same two helpers the acquire phase uses.
          // `downloadAndStoreImages` returns storage paths rather than row ids,
          // so the classify call is scoped by filtering its output on those
          // paths — `onlyImageIds` would need ids this helper never returns.
          const pageImageOrigins = new Map<
            string,
            { pageUrl: string; imageUrl: string }
          >();
          const storePageImagesFn =
            storePageImages ??
            (async (candidates: CandidateImage[]) => {
              const { downloadAndStoreImages } = await import("../image-download");
              const handles = await downloadAndStoreImages(
                [...candidates],
                effectiveTarget,
              );
              handles.forEach((handle, index) => {
                const candidate = candidates[index];
                if (!handle || !candidate) return;
                pageImageOrigins.set(handle, {
                  pageUrl: candidate.pageUrl ?? "",
                  imageUrl: candidate.url,
                });
              });
              return handles;
            });
          const classifyPageImagesFn =
            classifyPageImages ??
            (async (handles: string[]) => {
              const { classifyStoredImages } = await import("./classify-images");
              const wanted = new Set(handles);
              const classifyResult = await classifyStoredImages({
                brand,
                target: effectiveTarget,
                dryRun: dryRun === true,
                ...(jobId ? { jobId } : {}),
                ...(pendingPatch ? { pendingPatch } : {}),
                ctx,
              });
              return classifyResult.classified
                .filter(
                  (image) =>
                    typeof image.storage_path === "string" &&
                    wanted.has(image.storage_path),
                )
                .map((image) => {
                  const origin = pageImageOrigins.get(image.storage_path!);
                  return {
                    ...image,
                    sourceUrl: origin?.pageUrl ?? null,
                    imageUrl: origin?.imageUrl ?? null,
                  };
                });
            });

          const agentResult = await runProductsAgent(
            {
              brand: {
                id: brand.id,
                slug: brand.slug,
                name: brand.name ?? brand.slug,
                url: site.toString(),
              },
              pool: pool.products,
              imagePool: acquireImagePool ?? [],
              catalogResult: catalogResult ?? undefined,
              scrapedData: scrapedData ?? undefined,
              priorityProductUrls: acquisitionPageUrls,
              candidateIdsByUrl,
            },
            {
              // The scraper's guarded, audited fetch — never a raw `fetch`.
              fetchHtml: async (url: string) => {
                const metadata = await fetchHtmlWithMetadata(url);
                return { text: metadata.text ?? "", statusCode: metadata.status ?? 0 };
              },
              ...(renderProvider ? { renderProvider } : {}),
              loadOriginTexts: loadOriginTextsFn,
              lookupRegistryProducts:
                lookupRegistryProducts ?? lookupExactRegistryProducts,
              storePageImages: storePageImagesFn,
              classifyPageImages: classifyPageImagesFn,
            },
            {
              model,
              audit: {
                target: effectiveTarget,
                ...(jobId ? { jobId } : {}),
                modelName,
              },
            },
          );

          const agentOutcome = agentResult.agentOutcome;

          // FAILS CLOSED, deliberately (tweakable #6). `empty_pool` means the
          // agent was handed no candidates; re-running the single-call body
          // would ask a model to pick product pages while showing it none,
          // which is the exact failure `pages.length === 0` refuses above.
          if (agentOutcome === "blocked" && agentResult.error === "empty_pool") {
            Object.assign(ctx.summary, {
              agentOutcome,
              productsProposed: 0,
              catalogZeroReason: catalog.zeroReason ?? null,
            });
            return {
              phaseResult: {
                ...buildPhaseResult(
                  "products",
                  "skipped",
                  [],
                  0,
                  undefined,
                  "products agent blocked: empty candidate pool",
                ),
                agentOutcome,
                ...(catalog.zeroReason
                  ? { catalogZeroReason: catalog.zeroReason }
                  : {}),
                productsProposed: 0,
              },
              patch: {},
              proposals: [],
            };
          }

          if (agentOutcome !== "blocked" && agentOutcome !== "fallback") {
            const published = await publishProposals({
              proposals: agentResult.proposals,
              catalogCandidates,
              evaluations: agentResult.evaluations,
              originDecisions: agentResult.originDecisions,
              candidateIdsByUrl,
              ownedHosts: [...ownedHosts],
              brandId: brand.source_brand_id ?? brand.id,
              submissionId:
                effectiveTarget.type === "submission" ? effectiveTarget.id : null,
              jobId: jobId ?? null,
              collapsedCount,
              // The pool the agent verified against, INCLUDING anything its
              // decision-#35 batch added.
              imagePool: agentResult.imagePool,
              summary: ctx.summary,
              ...(candidateWriter ? { candidateWriter } : {}),
              ...(candidateRanker ? { candidateRanker } : {}),
            });

            const productsVerification =
              agentResult.verification as unknown as Record<string, unknown>;
            Object.assign(ctx.summary, {
              agentOutcome,
              productsVerification,
              agentBudget: agentResult.budget,
              productsProposed: published.length,
              catalogZeroReason: catalog.zeroReason ?? null,
            });
            return {
              phaseResult: {
                ...buildPhaseResult(
                  "products",
                  "succeeded",
                  published.length > 0 ? ["products"] : [],
                  0,
                  undefined,
                  `agent ${agentOutcome}: proposed ${published.length}`,
                ),
                agentOutcome,
                productsVerification,
                ...(catalog.zeroReason
                  ? { catalogZeroReason: catalog.zeroReason }
                  : {}),
                productsProposed: published.length,
              },
              patch: {
                products: published,
              },
              proposals: published,
            };
          }
          // Agent returned 'fallback' (or blocked for another reason) — fall
          // through to the single-call body, carrying its reason with it.
          agentFallback = {
            outcome: agentOutcome,
            reason: (agentResult.error ?? "unspecified").slice(0, 160),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(
            " → products agent failed, falling back to single-call body:",
            message,
          );
          // A throw leaves no outcome of its own; `fallback` is what the agent
          // would have reported, and matches the acquire phase's convention.
          agentFallback = { outcome: "fallback", reason: `threw: ${message}`.slice(0, 160) };
        }
        if (agentFallback) {
          console.warn(
            `  → products agent ${agentFallback.outcome}, using the single-call body: ${agentFallback.reason}`,
          );
          Object.assign(ctx.summary, {
            agentOutcome: agentFallback.outcome,
            agentError: agentFallback.reason,
          });
        }
      }
      let parseError = false;
      const { result, durationMs } = await timePhase<ProductsRunOutcome>(
        async () => {
          const evaluationPool = catalogCandidates;
          const { passed: evaluationCandidates } = applyGates(
            evaluationPool,
            [],
            [...ownedHosts],
          );
          let renderedTexts = new Map<string, string>();
          try {
            const missingEvidenceUrls = evaluationCandidates
              .filter(
                (candidate) => !catalog.evidence.has(candidate.normalizedUrl),
              )
              .map((candidate) => candidate.url);
            renderedTexts = new Map(
              evaluationCandidates.flatMap((candidate) => {
                const cached = catalog.evidence.get(
                  candidate.normalizedUrl,
                )?.text;
                return cached ? [[candidate.url, cached] as const] : [];
              }),
            );
            const loaded = await loadOriginTextsFn(missingEvidenceUrls);
            for (const [url, text] of loaded) renderedTexts.set(url, text);
          } catch {
            // Rendering is evidence collection, not publication. A renderer
            // failure removes origin qualification but keeps editorial output.
          }
          const excerptsByUrl = new Map<string, OriginExcerpt[]>();
          for (const candidate of evaluationCandidates) {
            excerptsByUrl.set(
              candidate.url,
              buildOriginExcerpts(
                candidateIdsByUrl.get(candidate.url)!,
                renderedTexts.get(candidate.url) ?? "",
              ),
            );
          }
          const originLines = evaluationCandidates.flatMap((candidate) => {
            const excerpts = excerptsByUrl.get(candidate.url) ?? [];
            return excerpts.map(
              (excerpt) =>
                `- ${candidate.url} | ${excerpt.id} | ${excerpt.text}`,
            );
          });
          const userContent = buildProductsUserContent(
            brand,
            site,
            scrapedData,
            pages,
            listingLines,
            originLines,
          );
          const productsSystemPrompt = await fetchLangfusePrompt(
            "products",
            PRODUCTS_SYSTEM_PROMPT,
            {
              category_list: CATEGORY_LIST,
              subcategory_vocab_block: SUBCATEGORY_VOCAB_BLOCK,
              material_vocab_block: MATERIAL_VOCAB_BLOCK,
              taiwan_usage_rules: TAIWAN_USAGE_RULES,
            },
          );
          const config = buildProfiledEnrichmentConfig(
            "products",
            productsSystemPrompt,
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
          const chatParams = {
            system: productsSystemPrompt,
            user: userContent,
            schema: PRODUCTS_SCHEMA,
            ...profileChatParams("products"),
          };
          const response = await client.chat(chatParams);
          if (!response.response.ok) {
            return {
              proposals: [],
              dropped: 0,
              dropReasons: {},
              rawCount: 0,
              calls: { attempted: 1, providerFailed: 1 },
              evaluations: new Map(),
              originDecisions: new Map(),
              candidateIdsByUrl,
            };
          }
          let callCount = 1;
          let validatedContent = parseAndValidate(
            response.content ?? "",
            productsParseShape,
          );
          // 1-retry: on validation failure, retry once with structured feedback
          if (!validatedContent.success) {
            const retryInstruction = validatedContent.issues
              ? formatRetryInstruction(validatedContent.issues)
              : validatedContent.error;
            const retryResponse = await client.chat({
              ...chatParams,
              user: `${userContent}\n\n${retryInstruction}`,
            });
            callCount += 1;
            if (retryResponse.response.ok) {
              validatedContent = parseAndValidate(
                retryResponse.content ?? "",
                productsParseShape,
              );
            }
          }
          const parsed: ProductsModelResult = validatedContent.success
            ? validatedContent.data
            : {};
          parseError = !validatedContent.success;
          const evaluations = validateCandidateEvaluations(
            parsed ?? {},
            evaluationCandidates,
            excerptsByUrl,
          );
          let registryMatches = new Map<string, ExactRegistryLookupResult>();
          try {
            registryMatches = await (
              lookupRegistryProducts ?? lookupExactRegistryProducts
            )(
              evaluationCandidates.map((candidate) => {
                const evaluation = evaluations.get(candidate.url);
                return {
                  candidateId: candidateIdsByUrl.get(candidate.url)!,
                  brand: brand.name ?? brand.slug,
                  product: candidate.title ?? "",
                  model: evaluation?.productModel ?? null,
                };
              }),
            );
          } catch {
            // Registry lookup fails closed; consensus may still qualify.
          }
          const originDecisions = new Map<string, CandidateOriginDecision>();
          for (const candidate of evaluationCandidates) {
            const deterministic = assessDeterministicOrigin(
              excerptsByUrl.get(candidate.url) ?? [],
            );
            const llm = evaluations.get(candidate.url)?.llmOrigin ?? {
              madeInTaiwan: false,
              materialsFromTaiwan: false,
              excerptIds: [],
            };
            const registryMatch = registryMatches.get(
              candidateIdsByUrl.get(candidate.url)!,
            );
            const registry: RegistryOriginAssessment =
              registryMatch?.assessment ?? {
                matched: false,
                recordId: null,
                reason: "no_exact_match",
              };
            const qualification = decideOriginQualification({
              deterministic,
              llm,
              registry,
            });
            originDecisions.set(candidate.url, {
              deterministic,
              llm,
              registry,
              mitQualified: qualification.qualified,
              qualificationMethod: qualification.method,
            });
          }
          const validation = validateProductProposals(parsed ?? {}, {
            siteUrl: site.toString(),
            candidates: evaluationCandidates,
          });
          return {
            ...validation,
            calls: { attempted: callCount, providerFailed: 0 },
            evaluations,
            originDecisions,
            candidateIdsByUrl,
          };
        },
      );

      // --- Candidate pool persistence (DEV-1610) ---
      // Runs inside the existing audited call; no new audit operation.
      // `publishProposals` is shared with the agent path above.
      const publishedProposals = await publishProposals({
        proposals: result.proposals,
        catalogCandidates,
        evaluations: result.evaluations,
        originDecisions: result.originDecisions,
        candidateIdsByUrl: result.candidateIdsByUrl,
        ownedHosts: [...ownedHosts],
        brandId: brand.source_brand_id ?? brand.id,
        submissionId:
          effectiveTarget.type === "submission" ? effectiveTarget.id : null,
        jobId: jobId ?? null,
        collapsedCount,
        imagePool: acquireImagePool ?? [],
        summary: ctx.summary,
        ...(candidateWriter ? { candidateWriter } : {}),
        ...(candidateRanker ? { candidateRanker } : {}),
      });

      Object.assign(ctx.summary, {
        productsFromModel: result.rawCount,
        ...(parseError ? { productsParseError: true } : {}),
        productsProposed: publishedProposals.length,
        productsDropped: result.dropped,
        productsDropReasons: result.dropReasons,
        catalogZeroReason: catalog.zeroReason ?? null,
        catalogAttempts: catalog.attempts,
      });

      // The trace the operator reads: this body ran because the agent did not
      // publish, and this is what the agent said.
      const agentNote = agentFallback
        ? ` (agent ${agentFallback.outcome}: ${agentFallback.reason})`
        : "";

      if (isLlmProviderFailure(result.calls)) {
        return {
          phaseResult: {
            ...buildPhaseResult(
              "products",
              "failed",
              [],
              durationMs,
              "LLM provider failed the products call",
              agentFallback ? agentNote.trim() : undefined,
            ),
            ...(agentFallback ? { agentOutcome: agentFallback.outcome } : {}),
            providerFailure: true,
            ...(catalog.zeroReason
              ? { catalogZeroReason: catalog.zeroReason }
              : {}),
            productsProposed: 0,
          },
          // NO ANSWER, NO OPINION: an empty patch leaves the previous run's
          // proposals alone. Clearing them on a transient provider error would
          // destroy good proposals over a 429. See `skipped`.
          patch: {},
          proposals: [],
        };
      }

      return {
        phaseResult: {
          ...buildPhaseResult(
            "products",
            "succeeded",
            publishedProposals.length > 0 ? ["products"] : [],
            durationMs,
            undefined,
            `proposed ${publishedProposals.length}, dropped ${result.dropped}${
              dryRun === true ? " (dry run — nothing written)" : ""
            }${agentNote}`,
          ),
          ...(agentFallback ? { agentOutcome: agentFallback.outcome } : {}),
          ...(catalog.zeroReason
            ? { catalogZeroReason: catalog.zeroReason }
            : {}),
          productsProposed: publishedProposals.length,
        },
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
        patch: { products: publishedProposals },
        proposals: publishedProposals,
      };
    },
    { subjectId: brand.id },
  );
}
