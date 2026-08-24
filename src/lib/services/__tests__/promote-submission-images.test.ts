import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  PromotionRow,
  PromotionStorage,
} from '@/lib/images/submission-image-promotion'
import { promoteApprovedBrandImages } from '../promote-submission-images'

/**
 * The approval boundary contract (DEV-1551): a brand that exists with
 * unservable images is recoverable, a failed approval is not. So promotion
 * must never propagate a failure into `approveSubmission`.
 *
 * No Supabase is mocked and none is constructed — both IO seams are injected,
 * which is why `promoteApprovedBrandImages` builds its client lazily.
 */
const BRAND_ID = '11111111-2222-3333-4444-555555555555'
const SOURCE_KEY = 'submissions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/x.webp'

const rows: PromotionRow[] = [
  { id: 'row-1', brandId: BRAND_ID, storagePath: SOURCE_KEY },
]

function storageThatAlwaysFails(): PromotionStorage {
  return {
    statObject: async () => {
      throw new Error('storage is down')
    },
    copyObject: async () => {
      throw new Error('storage is down')
    },
    setStoragePath: async () => {
      throw new Error('storage is down')
    },
  }
}

describe('promoteApprovedBrandImages', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not throw when every promotion fails', async () => {
    const result = await promoteApprovedBrandImages(BRAND_ID, {
      fetchRows: async () => rows,
      storage: storageThatAlwaysFails(),
    })

    expect(result?.failures).toHaveLength(1)
    expect(result?.copied).toBe(0)
  })

  it('names the brand and the unpromoted key in the log', async () => {
    await promoteApprovedBrandImages(BRAND_ID, {
      fetchRows: async () => rows,
      storage: storageThatAlwaysFails(),
    })

    const logged = vi.mocked(console.error).mock.calls.flat().join(' ')
    expect(logged).toContain(BRAND_ID)
    expect(logged).toContain(SOURCE_KEY)
  })

  it('does not throw when the row read itself fails', async () => {
    const result = await promoteApprovedBrandImages(BRAND_ID, {
      fetchRows: async () => {
        throw new Error('database unreachable')
      },
      storage: storageThatAlwaysFails(),
    })

    expect(result).toBeNull()
    expect(vi.mocked(console.error)).toHaveBeenCalled()
  })

  it('returns null and touches nothing when the brand has no submissions keys', async () => {
    const storage = storageThatAlwaysFails()

    const result = await promoteApprovedBrandImages(BRAND_ID, {
      fetchRows: async () => [],
      storage,
    })

    expect(result).toBeNull()
  })

  it('promotes and rewrites the row when storage cooperates', async () => {
    const updates: { rowId: string; targetKey: string }[] = []
    const copies: { sourceKey: string; targetKey: string }[] = []
    const storage: PromotionStorage = {
      statObject: async () => null,
      copyObject: async (sourceKey, targetKey) => {
        copies.push({ sourceKey, targetKey })
      },
      setStoragePath: async (rowId, targetKey) => {
        updates.push({ rowId, targetKey })
      },
    }

    const result = await promoteApprovedBrandImages(BRAND_ID, {
      fetchRows: async () => rows,
      storage,
    })

    expect(result?.copied).toBe(1)
    expect(copies).toEqual([
      { sourceKey: SOURCE_KEY, targetKey: `brands/${BRAND_ID}/x.webp` },
    ])
    expect(updates).toEqual([
      { rowId: 'row-1', targetKey: `brands/${BRAND_ID}/x.webp` },
    ])
  })
})
