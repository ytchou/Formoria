import { cleanBrandName } from '../brand-cleanup'
import type { PhaseResult } from '@/lib/types/curation'
import { buildPhaseResult, timePhase, type EnrichBrand, type EnrichPhase } from './types'

type CleanPhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
}

export async function runCleanPhase(
  brand: EnrichBrand,
  phases: EnrichPhase[]
): Promise<CleanPhaseOutput> {
  if (!phases.includes('clean')) {
    return {
      phaseResult: buildPhaseResult('clean', 'skipped', [], 0, undefined, 'clean phase not requested'),
      patch: {},
    }
  }

  const { result, durationMs } = await timePhase(async () => cleanBrandName(brand.name ?? ''))
  const changedFields = result.changed ? ['name'] : []

  return {
    phaseResult: buildPhaseResult('clean', 'succeeded', changedFields, durationMs),
    patch: result.changed ? { name: result.cleanedName } : {},
  }
}
