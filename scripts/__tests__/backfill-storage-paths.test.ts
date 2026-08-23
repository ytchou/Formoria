import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BACKFILL_TARGETS,
  type BackfillTarget,
  planBackfill,
  resolveStoragePath,
  summarize,
} from '../backfill-storage-paths'

// The seam under test is pure — no Supabase client is constructed anywhere in
// this file. This repo forbids mocking Supabase (`scripts/check-test-boundaries.mjs`),
// so the backfill's decision logic is driven with plain row objects instead.
const SUPABASE_URL = 'https://test-project.supabase.co'
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/brand-images/`

function targetFor(table: string): BackfillTarget {
  const target = BACKFILL_TARGETS.find((candidate) => candidate.table === table)
  if (!target) {
    throw new Error(`No backfill target registered for ${table}`)
  }
  return target
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('backfill-storage-paths', () => {
  it('derives a path from a public URL', () => {
    const brandId = randomUUID()
    const key = `brands/${brandId}/hero.webp`
    const target = targetFor('brand_images')

    const plan = planBackfill(target, [
      { id: 'row-1', url: `${PUBLIC_PREFIX}${key}`, storagePath: null },
    ])

    expect(resolveStoragePath(`${PUBLIC_PREFIX}${key}`)).toBe(key)
    expect(plan.updates).toEqual([{ id: 'row-1', storagePath: key }])
    expect(plan.unresolvable).toEqual([])
    expect(plan.alreadySet).toBe(0)
  })

  it('derives a path from a legacy nested URL', () => {
    // source='legacy' rows carry an extra path segment; the whole
    // bucket-relative key must survive, not just the last two segments.
    const brandId = randomUUID()
    const key = `brands/${brandId}/productPhotos/2018-catalogue.webp`
    const target = targetFor('brand_images')

    const plan = planBackfill(target, [
      { id: 'legacy-1', url: `${PUBLIC_PREFIX}${key}`, storagePath: null },
    ])

    expect(plan.updates).toEqual([{ id: 'legacy-1', storagePath: key }])
    expect(plan.updates[0]?.storagePath).toContain('/productPhotos/')
    expect(plan.unresolvable).toEqual([])
  })

  it('leaves a row alone when storage_path is already set', () => {
    const existing = `brands/${randomUUID()}/already-there.webp`
    const target = targetFor('brand_images')

    const plan = planBackfill(target, [
      {
        id: 'row-idempotent',
        url: `${PUBLIC_PREFIX}brands/${randomUUID()}/other.webp`,
        storagePath: existing,
      },
    ])

    expect(plan.updates).toEqual([])
    expect(plan.alreadySet).toBe(1)
    expect(plan.unresolvable).toEqual([])
  })

  it('reports, and does not guess, a URL that does not carry the bucket prefix', () => {
    const foreign = 'https://cdn.example.com/assets/hero.jpg'
    const target = targetFor('brand_images')

    const plan = planBackfill(target, [
      { id: 'row-foreign', url: foreign, storagePath: null },
    ])

    expect(resolveStoragePath(foreign)).toBeNull()
    expect(plan.updates).toEqual([])
    expect(plan.unresolvable).toEqual([{ id: 'row-foreign', url: foreign }])
    expect(summarize([plan]).totalUnresolvable).toBe(1)
  })

  it('fills hero_image_storage_path on brands, brand_submissions and events', () => {
    const tables = ['brands', 'brand_submissions', 'events'] as const

    const plans = tables.map((table) => {
      const key = `brands/${randomUUID()}/${table}-hero.webp`
      return planBackfill(targetFor(table), [
        { id: `${table}-1`, url: `${PUBLIC_PREFIX}${key}`, storagePath: null },
      ])
    })

    for (const plan of plans) {
      expect(plan.target.urlColumn).toBe('hero_image_url')
      expect(plan.target.pathColumn).toBe('hero_image_storage_path')
      expect(plan.updates).toHaveLength(1)
      expect(plan.updates[0]?.storagePath.startsWith('brands/')).toBe(true)
    }

    const summary = summarize(plans)
    expect(summary.totalFill).toBe(3)
    expect(summary.totalUnresolvable).toBe(0)
    expect(summary.perTable.map((row) => row.table)).toEqual([
      'brands',
      'brand_submissions',
      'events',
    ])
  })

  it('resolves a url whose host is a different Supabase project', () => {
    // Staging is restored from production, so every row there carries a
    // production host. Requiring an exact host match reported all 634 staging
    // rows unresolvable on 2026-08-23; a bucket-relative key is the same
    // object whichever project URL fronts it.
    const otherProject =
      'https://some-other-ref.supabase.co/storage/v1/object/public/brand-images/brands/abc/hero.webp'

    expect(resolveStoragePath(otherProject)).toBe('brands/abc/hero.webp')
  })

  it('still refuses a url that is not a brand-images object', () => {
    expect(
      resolveStoragePath('https://evil.example/storage/v1/object/public/other-bucket/x.webp'),
    ).toBeNull()
    expect(resolveStoragePath('https://evil.example/brands/abc/hero.webp')).toBeNull()
  })
})
