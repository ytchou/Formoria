import { describe, expect, it } from 'vitest'
import {
  declareMit,
  withdrawDeclaration,
  type MitDeclarationContext,
} from '@/lib/services/mit-declaration'

type BrandRow = {
  id: string
  mit_status: 'unverified' | 'declared' | 'verified'
  mit_declared_scope: 'all' | 'most' | 'some' | null
  mit_declared_at: string | null
  mit_declared_by: string | null
}

function seedBrand(initial: BrandRow) {
  const row = { ...initial }

  const client = {
    from: () => ({
      update: (patch: Partial<BrandRow>) => {
        const filters: Array<(candidate: BrandRow) => boolean> = []
        const builder = {
          eq(field: keyof BrandRow, value: unknown) {
            filters.push((candidate) => candidate[field] === value)
            return builder
          },
          in(field: keyof BrandRow, values: unknown[]) {
            filters.push((candidate) => values.includes(candidate[field]))
            return builder
          },
          select() {
            return {
              maybeSingle: async () => {
                if (!filters.every((filter) => filter(row))) {
                  return { data: null, error: null }
                }
                Object.assign(row, patch)
                return { data: { id: row.id }, error: null }
              },
            }
          },
        }
        return builder
      },
      select: () => {
        const filters: Array<(candidate: BrandRow) => boolean> = []
        const builder = {
          eq(field: keyof BrandRow, value: unknown) {
            filters.push((candidate) => candidate[field] === value)
            return builder
          },
          maybeSingle: async () => ({
            data: filters.every((filter) => filter(row))
              ? { mit_status: row.mit_status }
              : null,
            error: null,
          }),
        }
        return builder
      },
    }),
  }

  return { client, row }
}

function context(client: MitDeclarationContext['client']): MitDeclarationContext {
  return {
    client,
    userId: 'owner-1',
    now: () => '2026-07-22T01:02:03.000Z',
  }
}

describe('mit-declaration transitions', () => {
  it('declares MIT from unverified with scope and stamps declarer', async () => {
    const seeded = seedBrand({
      id: 'brand-1',
      mit_status: 'unverified',
      mit_declared_scope: null,
      mit_declared_at: null,
      mit_declared_by: null,
    })

    await expect(declareMit('brand-1', 'all', context(seeded.client))).resolves.toEqual({ ok: true })
    expect(seeded.row).toMatchObject({
      mit_status: 'declared',
      mit_declared_scope: 'all',
      mit_declared_at: '2026-07-22T01:02:03.000Z',
      mit_declared_by: 'owner-1',
    })

    await expect(declareMit('brand-1', 'most', context(seeded.client))).resolves.toEqual({ ok: true })
    expect(seeded.row.mit_declared_scope).toBe('most')
  })

  it('never downgrades a verified brand via declaration', async () => {
    const seeded = seedBrand({
      id: 'brand-1',
      mit_status: 'verified',
      mit_declared_scope: 'all',
      mit_declared_at: '2026-07-20T00:00:00.000Z',
      mit_declared_by: 'owner-1',
    })

    await expect(declareMit('brand-1', 'some', context(seeded.client))).resolves.toEqual({
      ok: false,
      code: 'already_verified',
    })
    expect(seeded.row).toMatchObject({
      mit_status: 'verified',
      mit_declared_scope: 'all',
      mit_declared_at: '2026-07-20T00:00:00.000Z',
    })
  })

  it('withdraw resets declaration fields', async () => {
    const seeded = seedBrand({
      id: 'brand-1',
      mit_status: 'declared',
      mit_declared_scope: 'some',
      mit_declared_at: '2026-07-20T00:00:00.000Z',
      mit_declared_by: 'owner-1',
    })

    await expect(withdrawDeclaration('brand-1', context(seeded.client))).resolves.toEqual({ ok: true })
    expect(seeded.row).toMatchObject({
      mit_status: 'unverified',
      mit_declared_scope: null,
      mit_declared_at: null,
      mit_declared_by: null,
    })
  })
})
