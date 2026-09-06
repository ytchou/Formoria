/**
 * Products dataset recorder — captures a brand's candidate pool, reads each
 * selected URL, and builds an eval dataset item body ready for Langfuse
 * `createDatasetItem`.
 *
 * Zero DB writes: the recorder calls only `readPage` (which hits the network)
 * and returns a body that the CLI persists to Langfuse. `setAuditWriteSeam`
 * must be installed by the caller before the first read.
 */

import type { ProductPageEvidence } from '../enrich-phases/products/read-page'
import type { ProductCandidate, UrlClass } from '../enrich-phases/product-candidates'
import { normalizeProductUrl } from '../enrich-phases/product-candidates'
import { selectCandidates } from '../enrich-phases/products/graph'

// ---------------------------------------------------------------------------
// toReadPageFetch
// ---------------------------------------------------------------------------

/**
 * Wraps a `FetchMetadata`-shaped result (`{ text: string | null, status: number | null }`)
 * into the `readPage` contract `{ text: string, statusCode: number }`.
 */
export function toReadPageFetch(r: {
  text: string | null
  status: number | null
}): { text: string; statusCode: number } {
  return { text: r.text ?? '', statusCode: r.status ?? 0 }
}

// ---------------------------------------------------------------------------
// buildPoolFromRows
// ---------------------------------------------------------------------------

type CandidateRow = {
  curation_job_id: string
  url: string
  title: string | null
  image_url: string | null
  supplier: string
  url_class: string
  search_position: number | null
  created_at: string
}

/**
 * Maps `curated_product_candidates` DB rows to `ProductCandidate[]`,
 * filtering to only the latest `curation_job_id`.
 */
export function buildPoolFromRows(rows: CandidateRow[]): ProductCandidate[] {
  if (rows.length === 0) return []

  // Find the latest job id by created_at
  let latestJobId = rows[0]!.curation_job_id
  let latestDate = rows[0]!.created_at
  for (const row of rows) {
    if (row.created_at > latestDate) {
      latestDate = row.created_at
      latestJobId = row.curation_job_id
    }
  }

  return rows
    .filter((r) => r.curation_job_id === latestJobId)
    .map((r) => ({
      url: r.url,
      normalizedUrl: normalizeProductUrl(r.url) ?? r.url,
      title: r.title ?? undefined,
      imageUrl: r.image_url ?? undefined,
      supplier: r.supplier,
      urlClass: r.url_class as UrlClass,
      searchPosition: r.search_position ?? undefined,
    }))
}

// ---------------------------------------------------------------------------
// recordPool
// ---------------------------------------------------------------------------

type RecordPoolParams = {
  brand: { id: string; slug: string; name: string; url?: string }
  pool: ProductCandidate[]
  priorityUrls: string[]
  urlsOverride: string[] | undefined
  readPage: (url: string) => Promise<ProductPageEvidence>
  candidateIdFactory: () => string
  target?: string
  jobId?: string
  candidateIds?: string[]
}

type RecordedItemBody = {
  id: string
  input: unknown
  expectedOutput: { decisions: never[] }
  status: 'ARCHIVED'
  metadata: {
    source: {
      target: string | undefined
      brandId: string
      jobId: string | undefined
      candidateIds: string[] | undefined
      recordedAt: string
    }
    humanApproval: { status: 'pending' }
    rubricVersion: 'dev-1649-v1'
  }
}

export async function recordPool(params: RecordPoolParams): Promise<RecordedItemBody> {
  const {
    brand,
    pool,
    priorityUrls,
    urlsOverride,
    readPage,
    candidateIdFactory,
    target,
    jobId,
    candidateIds: existingCandidateIds,
  } = params

  // Determine the selected subset
  let selected: ProductCandidate[]
  if (urlsOverride) {
    // Override: pick from pool in the override order
    const poolByUrl = new Map(pool.map((c) => [c.url, c]))
    selected = urlsOverride
      .map((url) => poolByUrl.get(url))
      .filter((c): c is ProductCandidate => c !== undefined)
  } else {
    selected = selectCandidates(pool, priorityUrls)
  }

  // Assign candidate ids
  const candidateIdsByUrl: Record<string, string> = {}
  for (const candidate of selected) {
    candidateIdsByUrl[candidate.url] = candidateIdFactory()
  }

  // Read each URL
  const evidence: Record<string, ProductPageEvidence> = {}
  for (const candidate of selected) {
    evidence[candidate.url] = await readPage(candidate.url)
  }

  // The recorded order IS the priority order for replay
  const recordedUrls = selected.map((c) => c.url)

  // Strip undefined fields from pool for clean JSON serialization
  const recordedPool = selected.map((c) => ({
    url: c.url,
    normalizedUrl: c.normalizedUrl,
    ...(c.title !== undefined ? { title: c.title } : {}),
    ...(c.imageUrl !== undefined ? { imageUrl: c.imageUrl } : {}),
    supplier: c.supplier,
    urlClass: c.urlClass,
    ...(c.searchPosition !== undefined ? { searchPosition: c.searchPosition } : {}),
  }))

  return {
    id: `products-agent:${brand.slug}`,
    input: {
      kind: 'products-agent-replay',
      brand,
      pool: recordedPool,
      candidateIdsByUrl,
      priorityProductUrls: recordedUrls,
      evidence,
    },
    expectedOutput: { decisions: [] },
    status: 'ARCHIVED',
    metadata: {
      source: {
        target,
        brandId: brand.id,
        jobId,
        candidateIds: existingCandidateIds,
        recordedAt: new Date().toISOString(),
      },
      humanApproval: { status: 'pending' },
      rubricVersion: 'dev-1649-v1',
    },
  }
}
