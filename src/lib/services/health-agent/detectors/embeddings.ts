/**
 * Embeddings detector — checks for embedding backlog using the same
 * source_hash predicate as `planEmbeddingRefresh`.
 *
 * The predicate: a document is stale when the existing embeddings map
 * has no entry for its product_id, or its source_hash differs.
 * Orphans are existing embeddings whose product_id has no document.
 */

import { planEmbeddingRefresh } from '@/lib/services/product-embeddings'
import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'
import { pagedRead, type PageableQuery } from '../paged-read'

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

type DocRow = { product_id: string; source_hash: string }
type EmbRow = { product_id: string; source_hash: string }

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const embeddingsDetector: Detector = {
  name: 'embeddings',
  source: 'pipeline',
  schedule: 'nightly',
  severity: 'medium',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const supabase = ctx.deps.supabase as {
      from: (table: string) => PageableQuery<unknown>
    }
    const findings: HealthFinding[] = []

    const documents = await pagedRead<DocRow>(
      supabase,
      'product_embedding_documents',
      {
        orderBy: [{ column: 'product_id' }],
        select: 'product_id, source_hash',
      },
    )

    const existing = await pagedRead<EmbRow>(supabase, 'product_embeddings', {
      orderBy: [{ column: 'product_id' }],
      select: 'product_id, source_hash',
    })

    // Reuse the exact same predicate as the refresh planner
    const plan = planEmbeddingRefresh(documents, existing)

    if (plan.stale.length > 0 || plan.orphanIds.length > 0) {
      findings.push({
        source: 'pipeline',
        fingerprint: stableFingerprint(
          'pipeline',
          'embedding-backlog',
          'all',
        ),
        title: `Embedding backlog: ${plan.stale.length} stale, ${plan.orphanIds.length} orphans`,
        severity: 'medium',
        evidence: {
          staleCount: plan.stale.length,
          orphanCount: plan.orphanIds.length,
          sampleStaleIds: plan.stale.slice(0, 5).map((d) => d.product_id),
          sampleOrphanIds: plan.orphanIds.slice(0, 5),
        },
        mergePolicy: 'automatic',
      })
    }

    return findings
  },
}
