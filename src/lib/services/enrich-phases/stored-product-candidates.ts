/**
 * Reads product candidates from persisted image provenance
 * (`brand_submissions` -> `brand_images.provider_metadata.pageUrl`).
 *
 * READ-ONLY: queries only, never writes.
 *
 * Mirrors the injection seam that `backfill-image-dimensions.ts` uses for
 * `DimensionReader` — the narrowest reader type is declared here, and the
 * default client is created lazily.
 */

import { createServiceClient } from '@/lib/supabase/service'
import {
  classifyProductUrl,
  normalizeProductUrl,
  type ProductCandidate,
} from './product-candidates'

// ---------------------------------------------------------------------------
// Narrowest reader types (injectable for testing)
// ---------------------------------------------------------------------------

type SubmissionQuery = {
  eq(column: string, value: unknown): PromiseLike<{
    data: Array<{ brand_id: string | null }> | null
    error: { message: string } | null
  }>
}

type ImageQuery = {
  eq(column: string, value: unknown): ImageQuery
  then: PromiseLike<{
    data: Array<{
      id: string
      source_url: string | null
      provider_metadata: unknown
    }> | null
    error: { message: string } | null
  }>['then']
}

export type StoredCandidateReader = {
  from(table: 'brand_submissions'): { select(columns: string): SubmissionQuery }
  from(table: 'brand_images'): { select(columns: string): ImageQuery }
  from(table: string): { select(columns: string): SubmissionQuery & ImageQuery }
}

// ---------------------------------------------------------------------------
// Provider metadata extraction
// ---------------------------------------------------------------------------

type ProviderFields = {
  pageUrl: string
  title?: string
  position?: number
}

/**
 * Reads `provider_metadata` defensively — it is untyped JSON in the DB.
 * Returns null if no string `pageUrl` is present.
 */
function extractProviderFields(
  metadata: unknown
): ProviderFields | null {
  if (!metadata || typeof metadata !== 'object') return null
  const obj = metadata as Record<string, unknown>

  const pageUrl = obj.pageUrl
  if (typeof pageUrl !== 'string' || !pageUrl) return null

  return {
    pageUrl,
    title: typeof obj.title === 'string' ? obj.title : undefined,
    position: typeof obj.position === 'number' ? obj.position : undefined,
  }
}

// ---------------------------------------------------------------------------
// loadStoredCandidates
// ---------------------------------------------------------------------------

/**
 * Loads product candidates from `brand_images` provenance for a given
 * submission target. Resolves submission -> brand_id, then queries
 * brand_images with `status='active'`.
 *
 * Never throws on a missing submission or brand — an absent pool degrades
 * the phase rather than failing it.
 */
export async function loadStoredCandidates(
  submissionId: string,
  client?: StoredCandidateReader
): Promise<ProductCandidate[]> {
  const supabase =
    client ?? (createServiceClient() as unknown as StoredCandidateReader)

  // Step 1: Resolve submission -> brand_id
  const { data: submissions, error: subError } = await supabase
    .from('brand_submissions')
    .select('brand_id')
    .eq('id', submissionId)

  if (subError || !submissions?.length) return []

  const brandId = submissions[0].brand_id
  if (!brandId) return []

  // Step 2: Query brand_images for active rows
  const { data: images, error: imgError } = await supabase
    .from('brand_images')
    .select('id, source_url, provider_metadata')
    .eq('brand_id', brandId)
    .eq('status', 'active')

  if (imgError || !images?.length) return []

  // Step 3: Extract candidates from provider_metadata
  const candidates: ProductCandidate[] = []

  for (const row of images) {
    const fields = extractProviderFields(row.provider_metadata)
    if (!fields) continue

    const normalizedUrl = normalizeProductUrl(fields.pageUrl)
    if (!normalizedUrl) continue

    candidates.push({
      url: fields.pageUrl,
      normalizedUrl,
      title: fields.title,
      imageUrl: row.source_url ?? undefined,
      supplier: 'stored',
      urlClass: classifyProductUrl(fields.pageUrl),
      searchPosition: fields.position,
    })
  }

  return candidates
}
