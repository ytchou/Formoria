import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import type { Brand } from '@/lib/types'

export function buildBrandEditDefaultValues(
  brand: Brand,
  draftData?: unknown,
): Partial<BrandEditFormValues> {
  const safeDraft = draftData && typeof draftData === 'object' && !Array.isArray(draftData)
    ? draftData as Record<string, unknown>
    : {}
  const merged = { ...brand, ...safeDraft } as Record<string, unknown>
  const defaults = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== null),
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
