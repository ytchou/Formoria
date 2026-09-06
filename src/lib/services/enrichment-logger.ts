const ENRICH_PREFIX = '[ENRICH]'

export const SEPARATOR = `${ENRICH_PREFIX} ════════════════════════════════════════`

export type EnrichmentSummary = {
  success: number
  skipped: number
  failed: number
  failedBrands: Array<{ slug: string; phase: string; error: string }>
  durationMs: number
  /**
   * Subset of `failed` whose failure was a search/LLM provider outage (Gate A)
   * rather than a brand with no data. Optional so existing summary literals stay
   * valid; every summary the job runner produces sets it.
   */
  providerFailed?: number
  /**
   * Set only when the LLM circuit breaker aborted the job. The scheduled sweep
   * reads it to stop claiming further jobs: on 2026-08-02 the pipeline ran for
   * 11.5 hours against a dead provider, and continuing to the next queued job
   * is how a one-job outage becomes an all-day one.
   */
  breakerTripped?: boolean
  /**
   * Verdicts the finalizer applied to targets the acquire gate skipped for
   * having no purchase channel (DEV-1702). Absent on a dry run, on a
   * non-enrich operation, and on every summary written before the finalizer
   * existed — which is why all four are optional rather than defaulted to 0.
   */
  noChannelRejected?: number
  noChannelHidden?: number
  /** Targets whose verdict threw and was isolated; the run continued. */
  verdictSkipped?: number
  /** Refreshes left pending because the brand could not be hidden. */
  hideFailed?: number
}

export type BrandPhaseProgress = {
  brandSlug: string
  brandIndex: number
  totalBrands: number
  phaseName: string
  phaseIndex: number
  totalPhases: number
  status: 'success' | 'skipped' | 'failed'
  durationMs: number
  error?: string
}

const STATUS_ICONS: Record<BrandPhaseProgress['status'], string> = {
  success: '✓',
  skipped: '⊘',
  failed: '✗',
}

const formatDuration = (durationMs: number): string => `${(durationMs / 1000).toFixed(1)}s`

export const formatPhaseProgress = (progress: BrandPhaseProgress): string =>
  `${ENRICH_PREFIX} [${progress.brandIndex}/${progress.totalBrands}] ${progress.brandSlug} — [${progress.phaseIndex}/${progress.totalPhases}] ${progress.phaseName} ${STATUS_ICONS[progress.status]} (${formatDuration(progress.durationMs)})`

export const formatBrandComplete = (
  slug: string,
  index: number,
  total: number,
  ms: number,
): string => `${ENRICH_PREFIX} [${index}/${total}] ${slug} — complete (${formatDuration(ms)})`

export const formatEnrichError = (message: string): string =>
  `${ENRICH_PREFIX} ERROR: ${message}`

export const formatEnrichPatchField = (key: string, value: unknown): string => {
  const display = Array.isArray(value)
    ? `[${value.length} items]`
    : typeof value === 'string' && value.length > 60
      ? `${value.slice(0, 60)}…`
      : value

  return `  ${ENRICH_PREFIX} ${key}: ${display}`
}

export const formatJobStart = (total: number): string[] => [
  SEPARATOR,
  `${ENRICH_PREFIX} Starting enrichment for ${total} brands`,
  SEPARATOR,
]

export const formatJobSummary = (summary: EnrichmentSummary): string[] => [
  SEPARATOR,
  `${ENRICH_PREFIX} Summary: ${summary.success} success, ${summary.skipped} skipped, ${summary.failed} failed`,
  ...summary.failedBrands.map(
    ({ slug, phase, error }) => `${ENRICH_PREFIX} Failed: ${slug} (${phase}: ${error})`,
  ),
  `${ENRICH_PREFIX} Duration: ${formatDuration(summary.durationMs)}`,
  SEPARATOR,
]

export const logEnrichmentProgress = (message: string): void => {
  console.log(JSON.stringify({
    event: 'enrich',
    logTag: ENRICH_PREFIX,
    message,
  }))
}
