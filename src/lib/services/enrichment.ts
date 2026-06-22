import type { BrandEnrichment } from '@/lib/services/brands'

export type EnrichmentStatus = 'not_enriched' | 'enriched' | 'partially_enriched'

export function getEnrichmentStatus(enrichment: BrandEnrichment | null | undefined): EnrichmentStatus {
  if (!enrichment) return 'not_enriched'
  const hasProductType = (enrichment.productType ?? '').trim() !== ''
  const hasHero = (enrichment.heroImageUrl ?? '').trim() !== ''
  const hasTags = (enrichment.tagSlugs ?? []).length > 0
  if (hasProductType && hasHero && hasTags) return 'enriched'
  return 'partially_enriched'
}
