import { cleanBrandName, type NameCleanupResult } from '../brand-cleanup'
import type { PhaseResult } from '@/lib/types/curation'
import { buildPhaseResult, timePhase, type EnrichBrand, type EnrichPhase } from './types'

type CleanPhaseOutput = {
  phaseResult: PhaseResult
  /**
   * The regex-cleaned name, emitted as the `cleaned` candidate for the DEV-1321
   * names phase. `null` when cleaning changed nothing. This phase no longer
   * persists it: `name` has exactly one writer now, and it is `names`.
   */
  cleanedName: string | null
}

/**
 * @param precomputed cleanup already applied to `brand.name` by the caller
 *   (the enrichment loop cleans names before the batch search phases so the
 *   SERP and image queries see the clean name — DEV-1279). When present it is
 *   reused verbatim instead of re-running the cleanup on the already-clean
 *   name, so the phase keeps reporting the real original → cleaned transition
 *   and still emits the value — now as a candidate rather than as a patch.
 *   Brands entering through other paths pass nothing and the phase cleans the
 *   name itself.
 */
export async function runCleanPhase(
  brand: EnrichBrand,
  phases: EnrichPhase[],
  precomputed?: NameCleanupResult
): Promise<CleanPhaseOutput> {
  if (!phases.includes('clean')) {
    return {
      phaseResult: buildPhaseResult('clean', 'skipped', [], 0, undefined, 'clean phase not requested'),
      cleanedName: null,
    }
  }

  const { result, durationMs } = await timePhase(async () =>
    precomputed ?? cleanBrandName(brand.name ?? '')
  )
  const changedFields = result.changed ? ['name'] : []
  const detail = result.changed ? `${result.originalName} → ${result.cleanedName}` : undefined

  // `changedFields` still reports `name`: the phase genuinely proposed a name
  // change and that is what the run log should show. Only the persistence moved
  // — the value now travels to the names arbiter as the `cleaned` candidate.
  return {
    phaseResult: buildPhaseResult('clean', 'succeeded', changedFields, durationMs, undefined, detail),
    cleanedName: result.changed ? result.cleanedName : null,
  }
}
