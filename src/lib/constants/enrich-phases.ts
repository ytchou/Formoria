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
  // `acquire` replaces `links` in the schedule. It runs the acquisition agent
  // (Browserless scraper + LLM extraction) to gather website data that `links`
  // formerly collected via direct fetches (DEV-1644 wave-A/B collapse).
  "acquire",
  // `names` sits after `acquire` because it needs every candidate the context
  // phases produce, and the image search builds its query from the name it
  // decides (DEV-1321).
  "names",
  "site_identity",
  "images",
  "classify_images",
  "descriptions",
  "stockists",
  // FAQ must run after `descriptions` (for `facts`); that is a hard ordering
  // constraint.
  "faq",
  // Curated-product proposals (DEV-1469). Last, and after `acquire` by hard
  // dependency: it proposes products from the brand's own site, so it needs the
  // resolved `purchase_website` from the acquisition agent.
  "products",
] as const;

export type EnrichPhaseName = (typeof ENRICH_PHASES)[number];

/**
 * Phase strings that are audited and reported but are NOT independently
 * selectable: they have no entry in `CURATION_TASKS`, an operator can never ask
 * for one, and they cannot be skipped without skipping the phase that owns
 * them. They still reach the database — `brand_ai_results.phase` and
 * `curation_job_targets.phase_results` both store them — so they are modelled
 * here rather than left as bare literals scattered through the services.
 *
 * - `facts` runs inside `descriptions`. `runDescriptionsPhase` returns early
 *   unless `phases.includes('descriptions')`, and `extractBrandFacts` is called
 *   unconditionally after that gate, so `facts` cannot run alone and cannot be
 *   skipped while `descriptions` runs.
 * - `founding_facts` and `founding_facts_verify` are the cited extraction and
 *   separate verification calls inside `descriptions` and the one-time audit.
 * - `classification` is the standalone category classifier that backs
 *   `tags` when `descriptions` did not already decide the category.
 * - `image-search` is the batched serper /images call that backs `images`. It
 *   is batched across a whole chunk, so it is not a per-brand phase.
 */
export const SUB_PHASES = [
  "facts",
  "founding_facts",
  "founding_facts_verify",
  "classification",
  "image-search",
  "persist",
  "acquisition",
] as const;

type SubPhaseName = (typeof SUB_PHASES)[number];

/**
 * Every phase string the pipeline can write to `brand_ai_results.phase` or to a
 * `PhaseResult`. Readers that render persisted phase strings (the admin job
 * view, the run-log export) must cover this set, not just `ENRICH_PHASES`.
 */
export const AUDITED_PHASES = [...ENRICH_PHASES, ...SUB_PHASES] as const;

export type AuditedPhaseName = EnrichPhaseName | SubPhaseName;

/**
 * Phases whose work is a serper.dev call. Both former members (`discover`,
 * `images`) are now DEFERRED — the acquisition agent replaces their role.
 * The array is kept empty so the stage-group structure remains intact.
 */
export const SERP_PHASES = [
] as const satisfies readonly EnrichPhaseName[];

/**
 * Phases whose work is LLM inference. These consume SERP output (live or
 * replayed from cache) and never call the search provider themselves.
 *
 * `acquire` runs the acquisition agent (Browserless + LLM) and is classified
 * as an LLM phase because its core work is LLM-driven extraction.
 */
export const ENRICH_LLM_PHASES = [
  "detect",
  "slugs",
  "tags",
  "acquire",
  "descriptions",
  "names",
  "faq",
  "products",
  "stockists",
] as const satisfies readonly EnrichPhaseName[];

/**
 * Phases that call neither serper.dev nor an LLM. Both former members (`clean`,
 * `links`) are now DEFERRED. The array is kept empty so the stage-group
 * structure remains intact.
 */
export const LOCAL_PHASES = [
] as const satisfies readonly EnrichPhaseName[];

/**
 * Every stage group, in the order a run executes them. Kept as one array so the
 * exhaustiveness test can assert that each non-deferred ENRICH_PHASES member is
 * assigned to exactly one stage.
 */
export const ENRICH_STAGE_GROUPS = {
  serp: SERP_PHASES,
  enrich: ENRICH_LLM_PHASES,
  local: LOCAL_PHASES,
} as const satisfies Record<string, readonly EnrichPhaseName[]>;

/**
 * Data-flow dependencies between phases. Each phase lists the phases whose
 * persisted output it reads. These are *verified* edges — the code actually
 * queries or reads the dependency's output.
 *
 * Deferred phases keep their entries (for the Record type) but have empty
 * dependency lists — they are never walked by phasesForTask after filtering,
 * and their former dependants now route through `acquire` instead.
 *
 * WHY the phase names survive: they are persisted in production —
 * `curation_jobs.params`, `curation_jobs.current_phase`,
 * `curation_job_targets.current_phase`, `curation_job_targets.phase_results`
 * and `brand_ai_results.phase` all store phase strings. Historical rows must
 * keep rendering, and `phase_results` must keep per-phase granularity so a
 * failure reads "links failed", not "identity failed". Tasks are therefore a
 * selection API that expands into phases, never a replacement for them.
 */
export const PHASE_DEPENDENCIES: Record<EnrichPhaseName, readonly EnrichPhaseName[]> = {
  // --- Deferred phases (empty deps, never walked) ---
  clean: [],
  discover: [],
  links: [],
  site_identity: [],
  images: [],
  classify_images: [],
  // --- Active phases ---
  detect: [],
  slugs: ["detect"],
  tags: ["descriptions"],
  acquire: ["detect"],
  names: ["detect", "acquire"],
  descriptions: ["acquire"],
  stockists: ["acquire"],
  faq: [],
  products: ["acquire", "names"],
};

/**
 * Phases that still exist in ENRICH_PHASES (for historical data) but are
 * deliberately not run. The acquisition agent (`acquire`) replaces the work
 * formerly done by `discover`, `clean`, `links`, `site_identity`, `images`,
 * and `classify_images` (DEV-1644 wave-A/B collapse).
 */
export const DEFERRED_PHASES = [
  "clean",
  "discover",
  "links",
  "site_identity",
  "images",
  "classify_images",
] as const satisfies readonly EnrichPhaseName[];

/** True when the phase exists but is deliberately not run. See DEFERRED_PHASES. */
export function isDeferredPhase(phase: string): boolean {
  return (DEFERRED_PHASES as readonly string[]).includes(phase);
}

/**
 * Operator-facing task vocabulary. Each task maps to its **terminal** phases;
 * prerequisites come from PHASE_DEPENDENCIES via `phasesForTask`.
 *
 * `full` covers every non-deferred phase and is the default when no task, steps
 * or phases are supplied.
 */
/**
 * The `visual` task was simplified from ["images", "classify_images", "products"]
 * to ["products"] as part of the wave-A/B collapse (DEV-1644). The closure walk
 * adds `acquire` and `names` via products' dependency chain.
 * `image` and `product` are kept as hidden aliases so stored job rows with
 * `params.task = "image"` or `"product"` still resolve correctly. They map to
 * the same phases as `visual` and are excluded from `CURATION_TASK_ORDER`.
 */
const VISUAL_PHASES = ["products"] as const satisfies readonly EnrichPhaseName[];

export const CURATION_TASKS = {
  identity: ["detect", "slugs", "acquire", "names"],
  visual: VISUAL_PHASES,
  // Hidden aliases — DB compat for stored params.task values
  image: VISUAL_PHASES,
  product: VISUAL_PHASES,
  editorial: ["descriptions", "faq", "tags", "stockists"],
  full: ENRICH_PHASES.filter(
    (phase) => !(DEFERRED_PHASES as readonly string[]).includes(phase),
  ),
} as const satisfies Record<string, readonly EnrichPhaseName[]>;

export type CurationTask = keyof typeof CURATION_TASKS;

/** All task names, in a fixed order for UI iteration. Hidden aliases excluded. */
export const CURATION_TASK_ORDER = [
  "identity",
  "visual",
  "editorial",
  "full",
] as const satisfies readonly CurationTask[];

/**
 * Computes the transitive closure of the given task's terminal phases over
 * PHASE_DEPENDENCIES, then returns the result sorted into ENRICH_PHASES order
 * so every downstream `phases.includes(...)` check behaves unchanged.
 */
export function phasesForTask(
  task: CurationTask,
): EnrichPhaseName[] {
  const terminals = CURATION_TASKS[task];
  const closure = new Set<string>();

  function walk(phase: EnrichPhaseName): void {
    if (closure.has(phase)) return;
    closure.add(phase);
    for (const dep of PHASE_DEPENDENCIES[phase]) {
      walk(dep);
    }
  }

  for (const phase of terminals) {
    walk(phase);
  }

  return ENRICH_PHASES.filter((phase) => closure.has(phase));
}

// ---------------------------------------------------------------------------
// Legacy step vocabulary — inlined into callers that parse stored job rows.
// These are NOT exported; callers that need to parse legacy `params.steps`
// should use `parseLegacyStepsToPhases` below.
// ---------------------------------------------------------------------------

const LEGACY_STEP_PHASES: Record<string, readonly EnrichPhaseName[]> = {
  context: ["detect", "slugs", "acquire", "names"],
  image: ["images", "classify_images"],
  detail: ["descriptions", "faq", "products", "tags", "stockists"],
};

/**
 * Expands legacy step names (from stored `params.steps`) into phases sorted in
 * ENRICH_PHASES order. Unknown step names are silently dropped. Returns
 * undefined when no valid steps are found, so the caller can fall through to
 * the next precedence level.
 */
export function parseLegacyStepsToPhases(
  steps: readonly string[],
): EnrichPhaseName[] | undefined {
  const requested = new Set<string>();
  for (const step of steps) {
    const phases = LEGACY_STEP_PHASES[step];
    if (phases) {
      for (const phase of phases) requested.add(phase);
    }
  }
  if (requested.size === 0) return undefined;
  return ENRICH_PHASES.filter((phase) => requested.has(phase));
}

/**
 * Image-specific enrichment phases. Both members are now DEFERRED — the
 * acquisition agent handles image-related work. The array is kept empty so
 * TEXT_ENRICH_PHASES derivation remains correct.
 */
export const IMAGE_ENRICH_PHASES = [
] as const satisfies readonly EnrichPhaseName[];

export const TEXT_ENRICH_PHASES = ENRICH_PHASES.filter(
  (phase) => !(IMAGE_ENRICH_PHASES as readonly string[]).includes(phase),
);
