/**
 * `reputation` was called `expansion` until 2026-08-03. The rename went all the
 * way through the stored phase string, so historical rows in
 * `curation_jobs.params`, `curation_jobs.current_phase`,
 * `curation_job_targets.current_phase` / `.phase_results` and
 * `brand_ai_results.phase` still say `expansion`. Every reader normalises the
 * legacy value rather than rewriting the rows: `job-runner`/`curation-jobs` map
 * it when parsing job params, `runlog-export` aliases it, and the admin job view
 * keeps a legacy label entry.
 */
export const ENRICH_PHASES = [
  "clean",
  "detect",
  "slugs",
  "tags",
  "discover",
  "links",
  // `names` sits between `links` and `images` because that is where it runs: it
  // needs every candidate the context phases produce, and the image search
  // builds its query from the name it decides (DEV-1321).
  "names",
  "site_identity",
  "images",
  "classify_images",
  "descriptions",
  "locations",
  "reputation",
] as const;

export type EnrichPhaseName = (typeof ENRICH_PHASES)[number];

/**
 * Phase strings that are audited and reported but are NOT independently
 * selectable: they have no entry in `CURATION_STEPS`, an operator can never ask
 * for one, and they cannot be skipped without skipping the phase that owns
 * them. They still reach the database — `brand_ai_results.phase` and
 * `curation_job_targets.phase_results` both store them — so they are modelled
 * here rather than left as bare literals scattered through the services.
 *
 * - `facts` runs inside `descriptions`. `runDescriptionsPhase` returns early
 *   unless `phases.includes('descriptions')`, and `extractBrandFacts` is called
 *   unconditionally after that gate, so `facts` cannot run alone and cannot be
 *   skipped while `descriptions` runs.
 * - `classification` is the standalone product-type classifier that backs
 *   `tags` when `descriptions` did not already decide the category.
 * - `image-search` is the batched serper /images call that backs `images`. It
 *   is batched across a whole chunk, so it is not a per-brand phase.
 */
export const SUB_PHASES = [
  "facts",
  "classification",
  "image-search",
  "persist",
] as const;

export type SubPhaseName = (typeof SUB_PHASES)[number];

/**
 * Every phase string the pipeline can write to `brand_ai_results.phase` or to a
 * `PhaseResult`. Readers that render persisted phase strings (the admin job
 * view, the run-log export) must cover this set, not just `ENRICH_PHASES`.
 */
export const AUDITED_PHASES = [...ENRICH_PHASES, ...SUB_PHASES] as const;

export type AuditedPhaseName = EnrichPhaseName | SubPhaseName;

/**
 * Phases whose work is a serper.dev call. The main pipeline is one-way
 * SERP -> ENRICHMENT, so these are the phases an admin runs to (re)build the
 * search context that the enrichment stage later consumes.
 *
 * - `discover` -> serper /search
 * - `images` -> serper /images (image-search phase)
 * - `locations` -> serper /maps (channels phase)
 */
export const SERP_PHASES = [
  "discover",
  "images",
  "locations",
] as const satisfies readonly EnrichPhaseName[];

/**
 * Phases whose work is LLM inference. These consume SERP output (live or
 * replayed from cache) and never call the search provider themselves.
 *
 * - `detect` / `slugs` / `tags` all read one batched OpenAI detect call;
 *   `slugs` is not a local transform because the slug it writes comes from the
 *   model's `slugGenerated` field.
 */
export const ENRICH_LLM_PHASES = [
  "detect",
  "slugs",
  "tags",
  "classify_images",
  "descriptions",
  "reputation",
  "names",
  "site_identity",
] as const satisfies readonly EnrichPhaseName[];

/**
 * Phases that call neither serper.dev nor an LLM.
 *
 * - `clean` is a pure string transform over the brand name.
 * - `links` fetches brand-owned URLs directly (scraper), so it depends on no
 *   paid provider and belongs to neither stage.
 */
export const LOCAL_PHASES = [
  "clean",
  "links",
] as const satisfies readonly EnrichPhaseName[];

/**
 * Every stage group, in the order a run executes them. Kept as one array so the
 * exhaustiveness test can assert that each ENRICH_PHASES member is assigned to
 * exactly one stage.
 */
export const ENRICH_STAGE_GROUPS = {
  serp: SERP_PHASES,
  enrich: ENRICH_LLM_PHASES,
  local: LOCAL_PHASES,
} as const satisfies Record<string, readonly EnrichPhaseName[]>;

/**
 * The three steps an operator selects. Everything below this line is the
 * *execution* vocabulary; this is the *selection* vocabulary.
 *
 * Grouped by data dependency, which is why the order is fixed:
 * - `context` gathers the brand's identity and its links.
 * - `image` needs context's brand name and resolved links to search and classify.
 * - `detail` needs context's site text AND image's classified alt text (see
 *   `descriptions.ts` -> `loadClassifiedImageAlts`), so it runs last.
 *
 * `tags` is deliberately in `detail`, not `context`: the product category is a
 * reasoning task decided by the descriptions phase from site content and image
 * alt text, not by detect from SERP snippets alone.
 *
 * `names` is in `context` for the mirror-image reason: it arbitrates the brand's
 * identity from what the other context phases proposed, so it cannot run before
 * them — and the `image` step's query is built from the name it decides, so it
 * cannot run after them either.
 *
 * WHY the phase names survive: they are persisted in production —
 * `curation_jobs.params`, `curation_jobs.current_phase`,
 * `curation_job_targets.current_phase`, `curation_job_targets.phase_results`
 * and `brand_ai_results.phase` all store phase strings. Historical rows must
 * keep rendering, and `phase_results` must keep per-phase granularity so a
 * failure reads "links failed", not "context failed". Steps are therefore a
 * selection API that expands into phases, never a replacement for them.
 */
/**
 * Phases that still exist but are deliberately not run.
 *
 * `locations` (serper /maps -> retail channels) is deferred as of 2026-08-03:
 * the retail-location output was not good enough to publish, so paying for a
 * /maps call per brand buys nothing. It stays in ENRICH_PHASES because the name
 * is persisted in `curation_jobs.params`, `curation_job_targets.phase_results`
 * and `brand_ai_results.phase`, and historical rows must keep rendering.
 *
 * Removing a phase from every step is what actually disables it — this list
 * exists so that absence reads as a decision rather than an oversight, and so
 * the coverage test can tell the two apart.
 *
 * The runner also consults this list directly (`isDeferredPhase`) so a deferred
 * phase costs neither a `current_phase` write nor a phase function call even
 * when an explicit `params.phases` array names it.
 */
export const DEFERRED_PHASES = [
  "locations",
] as const satisfies readonly EnrichPhaseName[];

/** True when the phase exists but is deliberately not run. See DEFERRED_PHASES. */
export function isDeferredPhase(phase: string): boolean {
  return (DEFERRED_PHASES as readonly string[]).includes(phase);
}

export const CURATION_STEPS = {
  context: ["discover", "detect", "slugs", "clean", "links", "names", "site_identity"],
  image: ["images", "classify_images"],
  detail: ["descriptions", "reputation", "tags"],
} as const satisfies Record<string, readonly EnrichPhaseName[]>;

export type CurationStep = keyof typeof CURATION_STEPS;

/** Execution order of the steps. `image` depends on `context`, `detail` on both. */
export const CURATION_STEP_ORDER = ["context", "image", "detail"] as const;

/**
 * Expands steps into phases, deduped and re-sorted into ENRICH_PHASES order so
 * every downstream `phases.includes(...)` check behaves exactly as it does for
 * a hand-written phase array.
 */
export function phasesForSteps(
  steps: readonly CurationStep[],
): EnrichPhaseName[] {
  const requested = new Set<string>(
    steps.flatMap((step) => CURATION_STEPS[step]),
  );
  return ENRICH_PHASES.filter((phase) => requested.has(phase));
}

export const IMAGE_ENRICH_PHASES = [
  "images",
  "classify_images",
] as const satisfies readonly EnrichPhaseName[];

export const TEXT_ENRICH_PHASES = ENRICH_PHASES.filter(
  (phase) => !(IMAGE_ENRICH_PHASES as readonly string[]).includes(phase),
);
