import { describe, expect, it } from 'vitest'
import { imagesDetector } from '../images'
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

type ImageRow = {
  id: string
  brand_id: string
  status: string
  storage_path: string | null
  sort_order: number
  created_at: string
}

function fakeSupabase(rows: ImageRow[]) {
  return {
    from(table: string) {
      if (table !== 'brand_images') {
        throw new Error(`Unexpected table: ${table}`)
      }
      let filtered = [...rows]
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) => (r as unknown as Record<string, unknown>)[_col] === val,
          )
          return builder
        },
        neq: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) => (r as unknown as Record<string, unknown>)[_col] !== val,
          )
          return builder
        },
        like: (_col: string, val: unknown) => {
          const pattern = (val as string).replace(/%/g, '.*')
          const regex = new RegExp(`^${pattern}$`)
          filtered = filtered.filter((r) => {
            const v = (r as unknown as Record<string, unknown>)[_col]
            return typeof v === 'string' && regex.test(v)
          })
          return builder
        },
        lt: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) =>
              ((r as unknown as Record<string, unknown>)[_col] as string) <
              (val as string),
          )
          return builder
        },
        gte: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) =>
              ((r as unknown as Record<string, unknown>)[_col] as string) >=
              (val as string),
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

describe('images detector', () => {
  it('reports rows still under submissions/ after 24 hours and duplicate active sort_order per brand', async () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const rows: ImageRow[] = [
      {
        id: 'img-1',
        brand_id: 'brand-a',
        status: 'active',
        storage_path: 'submissions/brand-a/hero.jpg',
        sort_order: 0,
        created_at: oldDate,
      },
      // Duplicate sort_order for the same brand
      {
        id: 'img-2',
        brand_id: 'brand-a',
        status: 'active',
        storage_path: 'brands/brand-a/img2.jpg',
        sort_order: 0,
        created_at: oldDate,
      },
    ]

    const findings = await imagesDetector.run(
      ctx({ deps: { supabase: fakeSupabase(rows) } }),
    )
    expect(findings.length).toBeGreaterThanOrEqual(2)

    const submissionFinding = findings.find((f) =>
      f.fingerprint.includes('submissions-path'),
    )
    expect(submissionFinding).toBeDefined()

    const dupFinding = findings.find((f) =>
      f.fingerprint.includes('duplicate-sort-order'),
    )
    expect(dupFinding).toBeDefined()
    expect(dupFinding!.evidence).toHaveProperty('brandId', 'brand-a')
  })
})
