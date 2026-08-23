import { describe, expect, it } from 'vitest'

import {
  executePromotions,
  formatPromotionReport,
  planPromotions,
  resolvePromotedKey,
  type PromotionRow,
  type PromotionStorage,
  type StoredObjectStat,
} from '@/lib/images/submission-image-promotion'

const BRAND_ID = '11111111-2222-3333-4444-555555555555'
const SUBMISSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SOURCE_KEY = `submissions/${SUBMISSION_ID}/99999999-8888-7777-6666-555555555555.webp`
const TARGET_KEY = `brands/${BRAND_ID}/99999999-8888-7777-6666-555555555555.webp`

function row(overrides: Partial<PromotionRow> = {}): PromotionRow {
  return {
    id: 'row-1',
    brandId: BRAND_ID,
    storagePath: SOURCE_KEY,
    ...overrides,
  }
}

/**
 * In-memory stand-in for Supabase Storage plus the `brand_images` row write.
 * The repo forbids mocking Supabase, so the engine takes its IO as a parameter
 * and the tests hand it this object.
 */
function createFakeStorage(options?: {
  objects?: Record<string, StoredObjectStat>
  failCopy?: boolean
  failUpdate?: boolean
}) {
  const objects = new Map<string, StoredObjectStat>(
    Object.entries(options?.objects ?? { [SOURCE_KEY]: { size: 1024 } }),
  )
  const updates: { rowId: string; targetKey: string }[] = []
  const copies: { sourceKey: string; targetKey: string }[] = []

  const storage: PromotionStorage = {
    statObject: async (key) => objects.get(key) ?? null,
    copyObject: async (sourceKey, targetKey) => {
      if (options?.failCopy) {
        throw new Error('storage unavailable')
      }
      const source = objects.get(sourceKey)
      if (!source) {
        throw new Error(`missing source ${sourceKey}`)
      }
      if (objects.has(targetKey)) {
        throw new Error('The resource already exists')
      }
      objects.set(targetKey, source)
      copies.push({ sourceKey, targetKey })
    },
    setStoragePath: async (rowId, targetKey) => {
      if (options?.failUpdate) {
        throw new Error('row update rejected')
      }
      updates.push({ rowId, targetKey })
    },
  }

  return { storage, objects, updates, copies }
}

describe('resolvePromotedKey', () => {
  it('derives a brands/ target key from a submissions/ key', () => {
    expect(resolvePromotedKey(BRAND_ID, SOURCE_KEY)).toBe(TARGET_KEY)
  })

  it('preserves the filename and extension', () => {
    expect(
      resolvePromotedKey(BRAND_ID, `submissions/${SUBMISSION_ID}/hero-01.PNG`),
    ).toBe(`brands/${BRAND_ID}/hero-01.PNG`)
  })

  it('returns null for a key that is not under submissions/', () => {
    expect(resolvePromotedKey(BRAND_ID, TARGET_KEY)).toBeNull()
  })

  it('returns null rather than guessing at a malformed key', () => {
    expect(resolvePromotedKey(BRAND_ID, 'submissions/')).toBeNull()
    expect(resolvePromotedKey(BRAND_ID, 'submissions/only-one-segment')).toBeNull()
    expect(resolvePromotedKey(BRAND_ID, `submissions/${SUBMISSION_ID}/`)).toBeNull()
    expect(resolvePromotedKey(BRAND_ID, 'submissions//x.webp')).toBeNull()
    expect(resolvePromotedKey(BRAND_ID, 'submissions/../brands/x.webp')).toBeNull()
  })

  it('returns null when the brand id is blank', () => {
    expect(resolvePromotedKey('   ', SOURCE_KEY)).toBeNull()
  })
})

describe('planPromotions', () => {
  it('plans one promotion per submissions/ row', () => {
    const plan = planPromotions([row()])

    expect(plan.scanned).toBe(1)
    expect(plan.promote).toEqual([
      { id: 'row-1', brandId: BRAND_ID, sourceKey: SOURCE_KEY, targetKey: TARGET_KEY },
    ])
    expect(plan.skipped).toEqual([])
    expect(plan.unresolvable).toEqual([])
  })

  it('skips a row already under brands/', () => {
    const plan = planPromotions([row({ storagePath: TARGET_KEY })])

    expect(plan.promote).toEqual([])
    expect(plan.skipped).toEqual([
      { id: 'row-1', storagePath: TARGET_KEY, reason: 'already-promoted' },
    ])
  })

  it('skips a row with no storage path', () => {
    const plan = planPromotions([row({ storagePath: null })])

    expect(plan.promote).toEqual([])
    expect(plan.skipped[0]?.reason).toBe('no-storage-path')
  })

  it('reports a row whose storage_path is malformed rather than guessing', () => {
    const plan = planPromotions([row({ storagePath: 'submissions/broken' })])

    expect(plan.promote).toEqual([])
    expect(plan.unresolvable).toEqual([
      { id: 'row-1', storagePath: 'submissions/broken', reason: 'malformed-key' },
    ])
  })

  it('reports a row with no brand id rather than guessing', () => {
    const plan = planPromotions([row({ brandId: null })])

    expect(plan.promote).toEqual([])
    expect(plan.unresolvable[0]?.reason).toBe('missing-brand-id')
  })
})

describe('executePromotions', () => {
  it('copies the object and rewrites the row, leaving the source in place', async () => {
    const fake = createFakeStorage()

    const result = await executePromotions(planPromotions([row()]), fake.storage)

    expect(result.copied).toBe(1)
    expect(result.failures).toEqual([])
    expect(fake.copies).toEqual([{ sourceKey: SOURCE_KEY, targetKey: TARGET_KEY }])
    expect(fake.updates).toEqual([{ rowId: 'row-1', targetKey: TARGET_KEY }])
    expect(fake.objects.has(SOURCE_KEY)).toBe(true)
  })

  it('is idempotent — a second run plans nothing', async () => {
    const fake = createFakeStorage()
    const rows = [row()]

    await executePromotions(planPromotions(rows), fake.storage)

    // A promoted row now carries the brands/ key, which is exactly the state a
    // second run reads back from the database.
    const secondPlan = planPromotions([row({ storagePath: TARGET_KEY })])
    const second = await executePromotions(secondPlan, fake.storage)

    expect(secondPlan.promote).toEqual([])
    expect(second.copied).toBe(0)
    expect(fake.copies).toHaveLength(1)
  })

  it('adopts an identical target left behind by an interrupted run', async () => {
    const fake = createFakeStorage({
      objects: { [SOURCE_KEY]: { size: 1024 }, [TARGET_KEY]: { size: 1024 } },
    })

    const result = await executePromotions(planPromotions([row()]), fake.storage)

    expect(result.copied).toBe(0)
    expect(result.adopted).toBe(1)
    expect(fake.copies).toEqual([])
    expect(fake.updates).toEqual([{ rowId: 'row-1', targetKey: TARGET_KEY }])
  })

  it('never overwrites a target occupied by a different object', async () => {
    const fake = createFakeStorage({
      objects: { [SOURCE_KEY]: { size: 1024 }, [TARGET_KEY]: { size: 2048 } },
    })

    const result = await executePromotions(planPromotions([row()]), fake.storage)

    expect(result.conflicts).toHaveLength(1)
    expect(fake.copies).toEqual([])
    expect(fake.updates).toEqual([])
    expect(fake.objects.get(TARGET_KEY)).toEqual({ size: 2048 })
  })

  it('records a failure instead of throwing when the copy fails', async () => {
    const fake = createFakeStorage({ failCopy: true })

    const result = await executePromotions(planPromotions([row()]), fake.storage)

    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.sourceKey).toBe(SOURCE_KEY)
    expect(fake.updates).toEqual([])
  })

  it('records a failure instead of throwing when the row update fails', async () => {
    const fake = createFakeStorage({ failUpdate: true })

    const result = await executePromotions(planPromotions([row()]), fake.storage)

    expect(result.failures).toHaveLength(1)
    expect(result.copied).toBe(0)
  })

  it('keeps promoting the remaining rows after one row fails', async () => {
    const goodSource = `submissions/${SUBMISSION_ID}/good.webp`
    const fake = createFakeStorage({
      objects: { [goodSource]: { size: 10 } },
    })

    const result = await executePromotions(
      planPromotions([
        row({ id: 'missing', storagePath: SOURCE_KEY }),
        row({ id: 'good', storagePath: goodSource }),
      ]),
      fake.storage,
    )

    expect(result.failures).toHaveLength(1)
    expect(result.copied).toBe(1)
    expect(fake.updates).toEqual([
      { rowId: 'good', targetKey: `brands/${BRAND_ID}/good.webp` },
    ])
  })
})

describe('formatPromotionReport', () => {
  it('names every key it could not promote', async () => {
    const fake = createFakeStorage({ failCopy: true })
    const result = await executePromotions(planPromotions([row()]), fake.storage)

    const report = formatPromotionReport(result, { live: true })

    expect(report).toContain(SOURCE_KEY)
    expect(report).toContain('LIVE')
  })

  it('marks a dry run and writes no live wording', () => {
    const report = formatPromotionReport(
      { plan: planPromotions([row()]), outcomes: [], copied: 0, adopted: 0, conflicts: [], failures: [] },
      { live: false },
    )

    expect(report).toContain('dry run')
    expect(report).toContain('would promote 1')
  })
})
