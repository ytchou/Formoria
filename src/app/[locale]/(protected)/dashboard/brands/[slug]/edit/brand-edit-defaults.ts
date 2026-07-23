import { SECTION_FIELDS, type BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { BRAND_DRAFT_PROGRESS_KEY } from '@/lib/services/brands'
import type { Brand } from '@/lib/types'

const BRAND_EDIT_FIELD_KEYS = new Set(
  Object.values(SECTION_FIELDS).flat() as (keyof BrandEditFormValues)[],
)

export function getCompletedWizardSteps(draftData?: unknown): number[] {
  if (!draftData || typeof draftData !== 'object' || Array.isArray(draftData)) {
    return []
  }

  const value = (draftData as Record<string, unknown>)[BRAND_DRAFT_PROGRESS_KEY]
  if (!Array.isArray(value)) return []

  return Array.from(
    new Set(
      value.filter(
        (step): step is number => Number.isInteger(step) && step >= 0,
      ),
    ),
  ).sort((left, right) => left - right)
}

export function getInitialWizardStep(
  rawStep: string | undefined,
  completedSteps: number[],
  totalSteps: number,
): number {
  const maxIndex = Math.max(totalSteps - 1, 0)

  if (rawStep) {
    const parsed = parseInt(rawStep, 10)
    return Math.max(0, Math.min(Number.isNaN(parsed) ? 0 : parsed, maxIndex))
  }

  if (completedSteps.length === 0) return 0

  const completed = new Set(completedSteps)
  for (let step = 0; step <= maxIndex; step += 1) {
    if (!completed.has(step)) return step
  }

  return maxIndex
}

export function buildBrandEditDefaultValues(
  brand: Brand,
  draftData?: unknown,
): Partial<BrandEditFormValues> {
  const safeDraft =
    draftData && typeof draftData === 'object' && !Array.isArray(draftData)
      ? Object.fromEntries(
          Object.entries(draftData as Record<string, unknown>).filter(([key]) =>
            BRAND_EDIT_FIELD_KEYS.has(key as keyof BrandEditFormValues),
          ),
        )
      : {}
  const merged = { ...brand, ...safeDraft } as Record<string, unknown>
  const defaults = Object.fromEntries(
    Object.entries(merged).filter(
      ([key, value]) => key !== 'retailLocations' && value !== null,
    ),
  ) as Partial<BrandEditFormValues>
  const reputation = merged.reputationSummary

  if (reputation && typeof reputation === 'object' && 'text' in reputation) {
    const reputationRecord = reputation as Record<string, unknown>
    defaults.reputationSummary = String(reputationRecord.text ?? '')
    defaults.reputationSources = Array.isArray(reputationRecord.sources)
      ? reputationRecord.sources as { url: string }[]
      : []
  }

  return defaults
}
