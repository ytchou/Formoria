import { describe, expect, it } from 'vitest'
import { JUNK_TAGS, applyClassifications } from '../classify-images'

/**
 * These cover the two policy decisions that ship together:
 *   1. `logo` is no longer junk — a clean brand mark represents the brand.
 *   2. Hero ordering ranks by tag first, score second.
 *
 * (2) is not optional polish. Measured production scores put logo at p50 90 and
 * product/lifestyle/packaging at p50 85, so a pure score sort would promote the
 * logo above real photography on most brand pages.
 */

type Classified = Parameters<typeof applyClassifications>[0][number]

function classified(
  id: string,
  tag: Classified['tag'],
  score: number,
  storagePath: string | null = `brands/${id}.jpg`,
): Classified {
  return { id, tag, score, storage_path: storagePath }
}

describe('applyClassifications ordering', () => {
  it('ranks a product photo ahead of a higher-scoring logo', () => {
    const { ordered } = applyClassifications([
      classified('logo', 'logo', 95),
      classified('product', 'product', 85),
    ])

    // Without the tag rank this is ['logo', 'product'].
    expect(ordered.map((image) => image.id)).toEqual(['product', 'logo'])
  })

  it('falls back to score within the same rank', () => {
    const { ordered } = applyClassifications([
      classified('lifestyle-low', 'lifestyle', 70),
      classified('product-high', 'product', 90),
      classified('packaging-mid', 'packaging', 80),
    ])

    expect(ordered.map((image) => image.id)).toEqual([
      'product-high',
      'packaging-mid',
      'lifestyle-low',
    ])
  })

  it('keeps a logo out of the rejected set', () => {
    const { ordered, rejectedIds, pathsToDelete } = applyClassifications([
      classified('logo', 'logo', 90),
    ])

    expect(rejectedIds).toEqual([])
    expect(pathsToDelete).toEqual([])
    expect(ordered.map((image) => image.id)).toEqual(['logo'])
  })

  it('still rejects a text banner and queues its object for deletion', () => {
    const { ordered, rejectedIds, rejectedUpdates, pathsToDelete } =
      applyClassifications([classified('banner', 'text_banner', 70)])

    expect(rejectedIds).toEqual(['banner'])
    expect(ordered).toEqual([])
    expect(pathsToDelete).toEqual(['brands/banner.jpg'])
    expect(rejectedUpdates[0]?.row).toEqual({
      status: 'rejected',
      storage_path: null,
    })
  })

  it('rejects promo and irrelevant but never product, lifestyle, packaging or logo', () => {
    const { ordered, rejectedIds } = applyClassifications([
      classified('a', 'promo', 90),
      classified('b', 'irrelevant', 90),
      classified('c', 'product', 60),
      classified('d', 'lifestyle', 60),
      classified('e', 'packaging', 60),
      classified('f', 'logo', 60),
    ])

    expect(rejectedIds.toSorted()).toEqual(['a', 'b'])
    expect(ordered.map((image) => image.id).toSorted()).toEqual([
      'c',
      'd',
      'e',
      'f',
    ])
  })
})

describe('JUNK_TAGS', () => {
  it('treats logo as a keepable brand image', () => {
    expect(JUNK_TAGS.has('logo')).toBe(false)
  })

  it('still rejects promotional and text-first imagery', () => {
    expect([...JUNK_TAGS].toSorted()).toEqual([
      'irrelevant',
      'promo',
      'text_banner',
    ])
  })
})
