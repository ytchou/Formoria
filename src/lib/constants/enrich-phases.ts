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

export const IMAGE_ENRICH_PHASES = [
  'images',
  'classify_images',
] as const satisfies readonly EnrichPhaseName[]

export const TEXT_ENRICH_PHASES = ENRICH_PHASES.filter(
  (phase) => !(IMAGE_ENRICH_PHASES as readonly string[]).includes(phase),
)
