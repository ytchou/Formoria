export const ENRICH_PHASES = [
  'clean',
  'detect',
  'slugs',
  'tags',
  'discover',
  'links',
  'images',
  'classify_images',
  'descriptions',
  'locations',
  'expansion',
] as const

export type EnrichPhaseName = (typeof ENRICH_PHASES)[number]

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
  'discover',
  'images',
  'locations',
] as const satisfies readonly EnrichPhaseName[]

/**
 * Phases whose work is LLM inference. These consume SERP output (live or
 * replayed from cache) and never call the search provider themselves.
 *
 * - `detect` / `slugs` / `tags` all read one batched OpenAI detect call;
 *   `slugs` is not a local transform because the slug it writes comes from the
 *   model's `slugGenerated` field.
 */
export const ENRICH_LLM_PHASES = [
  'detect',
  'slugs',
  'tags',
  'classify_images',
  'descriptions',
  'expansion',
] as const satisfies readonly EnrichPhaseName[]

/**
 * Phases that call neither serper.dev nor an LLM.
 *
 * - `clean` is a pure string transform over the brand name.
 * - `links` fetches brand-owned URLs directly (scraper), so it depends on no
 *   paid provider and belongs to neither stage.
 */
export const LOCAL_PHASES = [
  'clean',
  'links',
] as const satisfies readonly EnrichPhaseName[]

/**
 * Every stage group, in the order a run executes them. Kept as one array so the
 * exhaustiveness test can assert that each ENRICH_PHASES member is assigned to
 * exactly one stage.
 */
export const ENRICH_STAGE_GROUPS = {
  serp: SERP_PHASES,
  enrich: ENRICH_LLM_PHASES,
  local: LOCAL_PHASES,
} as const satisfies Record<string, readonly EnrichPhaseName[]>

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
 * WHY the phase names survive: they are persisted in production —
 * `curation_jobs.params`, `curation_jobs.current_phase`,
 * `curation_job_targets.current_phase`, `curation_job_targets.phase_results`
 * and `brand_ai_results.phase` all store phase strings. Historical rows must
 * keep rendering, and `phase_results` must keep per-phase granularity so a
 * failure reads "links failed", not "context failed". Steps are therefore a
 * selection API that expands into phases, never a replacement for them.
 */
export const CURATION_STEPS = {
  context: ['discover', 'detect', 'slugs', 'clean', 'links'],
  image: ['images', 'classify_images'],
  detail: ['descriptions', 'locations', 'expansion', 'tags'],
} as const satisfies Record<string, readonly EnrichPhaseName[]>

export type CurationStep = keyof typeof CURATION_STEPS

/** Execution order of the steps. `image` depends on `context`, `detail` on both. */
export const CURATION_STEP_ORDER = ['context', 'image', 'detail'] as const

/**
 * Expands steps into phases, deduped and re-sorted into ENRICH_PHASES order so
 * every downstream `phases.includes(...)` check behaves exactly as it does for
 * a hand-written phase array.
 */
export function phasesForSteps(
  steps: readonly CurationStep[],
): EnrichPhaseName[] {
  const requested = new Set<string>(steps.flatMap((step) => CURATION_STEPS[step]))
  return ENRICH_PHASES.filter((phase) => requested.has(phase))
}

export const IMAGE_ENRICH_PHASES = [
  'images',
  'classify_images',
] as const satisfies readonly EnrichPhaseName[]

export const TEXT_ENRICH_PHASES = ENRICH_PHASES.filter(
  (phase) => !(IMAGE_ENRICH_PHASES as readonly string[]).includes(phase),
)
