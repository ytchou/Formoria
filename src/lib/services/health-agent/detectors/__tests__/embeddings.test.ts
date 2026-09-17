import { describe, expect, it } from 'vitest'
import { embeddingsDetector } from '../embeddings'
import type { DetectorContext } from '../../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(overrides?: Partial<DetectorContext>): DetectorContext {
  return {
    date: '2026-09-17',
    deadline: Date.now() + 60_000,
    signal: new AbortController().signal,
    dryRun: false,
    deps: {},
    ...overrides,
  }
}

type DocRow = { product_id: string; source_hash: string }
type EmbRow = { product_id: string; source_hash: string }

function fakeSupabase(documents: DocRow[], existing: EmbRow[]) {
  return {
    from(table: string) {
      const data =
        table === 'product_embedding_documents' ? documents : existing
      let filtered = [...data]
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) => (r as unknown as Record<string, unknown>)[_col] === val,
          )
          return builder
        },
        order: () => builder,
        range: (_from: number, _to: number) =>
          Promise.resolve({
            data: filtered.slice(_from, _to + 1),
            error: null,
          }),
      }
      return builder
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('embeddings detector', () => {
  it('backlog uses the same source_hash predicate as planEmbeddingRefresh', async () => {
    // planEmbeddingRefresh marks a document as stale when:
    // 1. The existing map has no entry for that product_id (new doc)
    // 2. The existing source_hash differs from the document source_hash
    // The detector should report a finding when stale count exceeds a threshold.
    const documents: DocRow[] = [
      { product_id: 'p1', source_hash: 'hash-a-new' },
      { product_id: 'p2', source_hash: 'hash-b' },
      { product_id: 'p3', source_hash: 'hash-c-changed' },
    ]
    const existing: EmbRow[] = [
      { product_id: 'p2', source_hash: 'hash-b' }, // up to date
      { product_id: 'p3', source_hash: 'hash-c-old' }, // stale
      { product_id: 'p4', source_hash: 'hash-d' }, // orphan
    ]

    const findings = await embeddingsDetector.run(
      ctx({ deps: { supabase: fakeSupabase(documents, existing) } }),
    )

    // Should report stale (p1 missing from existing, p3 hash mismatch) and orphan (p4)
    expect(findings.length).toBeGreaterThanOrEqual(1)
    const finding = findings.find((f) => f.fingerprint.includes('embedding-backlog'))
    expect(finding).toBeDefined()
    expect(finding!.evidence).toHaveProperty('staleCount', 2)
    expect(finding!.evidence).toHaveProperty('orphanCount', 1)
  })
})
