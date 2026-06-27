export const ENRICH_PREFIX = '[ENRICH]'

export const SEPARATOR = `${ENRICH_PREFIX} ════════════════════════════════════════`

export type EnrichmentSummary = {
  success: number
  skipped: number
  failed: number
  failedBrands: Array<{ slug: string; phase: string; error: string }>
  durationMs: number
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
  console.log(message)
}
