import { describe, expect, it } from 'vitest'
import { JUNK_TAGS, MIN_KEEP_SCORE, applyClassifications, parseClassificationBatch } from '../classify-images'

/**
 * These cover the policy decisions that ship together:
 *   1. `logo` is not junk — a clean brand mark represents the brand.
 *   2. Hero ordering is a PURE quality sort. The tag no longer participates:
 *      a higher-scoring logo outranks a lower-scoring product photo.
 *   3. The only shape correction is PORTRAIT_PENALTY (15 points), because 58%
 *      of human-rejected images were portrait versus 23% of kept ones. It is a
 *      penalty, not an exclusion — a portrait must still be usable.
 */

type Classified = Parameters<typeof applyClassifications>[0][number]

function classified(
  id: string,
  tag: Classified['tag'],
  score: number,
  storagePath: string | null = `brands/${id}.jpg`,
): Classified {
  // Landscape by default so orientation only matters where a test sets it.
  return { id, tag, score, storage_path: storagePath, width: 1200, height: 800 }
}

function portrait(image: Classified): Classified {
  return { ...image, width: 800, height: 1200 }
}

describe('applyClassifications ordering', () => {
  it('ranks purely by score, so a better logo beats a worse product photo', () => {
    const { ordered } = applyClassifications([
      classified('product', 'product', 85),
      classified('logo', 'logo', 95),
    ])

    expect(ordered.map((image) => image.id)).toEqual(['logo', 'product'])
  })

  it('orders every kept image by score regardless of tag', () => {
    const { ordered } = applyClassifications([
      classified('low', 'product', 70),
      classified('high', 'product', 90),
      classified('mid', 'logo', 80),
    ])

    expect(ordered.map((image) => image.id)).toEqual(['high', 'mid', 'low'])
  })

  it('demotes a portrait image below a slightly worse landscape one', () => {
    const { ordered } = applyClassifications([
      portrait(classified('tall', 'product', 90)),
      classified('wide', 'product', 80),
    ])

    // 90 - 15 = 75, so the 80-point landscape takes the hero slot.
    expect(ordered.map((image) => image.id)).toEqual(['wide', 'tall'])
  })

  it('lets a clearly better portrait image still win the hero slot', () => {
    const { ordered } = applyClassifications([
      portrait(classified('tall', 'product', 95)),
      classified('wide', 'product', 70),
    ])

    expect(ordered.map((image) => image.id)).toEqual(['tall', 'wide'])
  })

  it('keeps a portrait-only brand orderable rather than dropping it', () => {
    const { ordered, rejectedIds } = applyClassifications([
      portrait(classified('a', 'product', 70)),
      portrait(classified('b', 'product', 88)),
    ])

    expect(rejectedIds).toEqual([])
    expect(ordered.map((image) => image.id)).toEqual(['b', 'a'])
  })

  it('does not penalise an image with unknown dimensions', () => {
    const { ordered } = applyClassifications([
      { id: 'unsized', tag: 'product', score: 82, storage_path: null },
      classified('wide', 'product', 80),
    ])

    expect(ordered.map((image) => image.id)).toEqual(['unsized', 'wide'])
  })

  it('keeps a logo out of the rejected set', () => {
    const { ordered, rejectedIds } = applyClassifications([
      classified('logo', 'logo', 90),
    ])

    expect(rejectedIds).toEqual([])
    expect(ordered.map((image) => image.id)).toEqual(['logo'])
  })

  it('rejects an explicit reject disposition while retaining its storage object', () => {
    const { ordered, rejectedIds, rejectedUpdates } = applyClassifications([
      {
        id: 'banner',
        tag: 'product',
        score: 70,
        storage_path: 'brands/banner.jpg',
        disposition: 'reject',
        rejectionReasons: ['text_dominant'],
      },
    ])

    expect(rejectedIds).toEqual(['banner'])
    expect(ordered).toEqual([])
    expect(rejectedUpdates[0]?.row).toEqual({
      status: 'rejected',
      storage_path: 'brands/banner.jpg',
      tags: null,
      rejection_reasons: ['text_dominant'],
    })
  })

  it('still rejects LEGACY junk-tagged rows but never product or logo ones', () => {
    const { ordered, rejectedIds } = applyClassifications([
      classified('a', 'promo', 90),
      classified('b', 'irrelevant', 90),
      classified('c', 'product', 60),
      classified('d', 'logo', 60),
    ])

    expect(rejectedIds.toSorted()).toEqual(['a', 'b'])
    expect(ordered.map((image) => image.id).toSorted()).toEqual(['c', 'd'])
  })
})

describe('JUNK_TAGS', () => {
  it('treats logo as a keepable brand image', () => {
    expect(JUNK_TAGS.has('logo')).toBe(false)
  })

  it('covers only the LEGACY rejection tags, not the current keep vocabulary', () => {
    expect([...JUNK_TAGS].toSorted()).toEqual([
      'irrelevant',
      'promo',
      'text_banner',
    ])
    for (const keepTag of ['product', 'logo']) {
      expect(JUNK_TAGS.has(keepTag)).toBe(false)
    }
    // Legacy keep tags fold into `product`; they must never read as junk.
    for (const legacyKeepTag of ['lifestyle', 'packaging']) {
      expect(JUNK_TAGS.has(legacyKeepTag)).toBe(false)
    }
  })
})

describe('parseClassificationBatch', () => {
  it('accepts only an explicit keep tag or a reject reason', () => {
    const verdicts = parseClassificationBatch(JSON.stringify({
      classifications: [
        {
          id: '1',
          disposition: 'keep',
          tag: 'logo',
          reasons: [],
          score: 91,
          alt_zh: '品牌標誌',
          alt_en: 'Brand logo',
        },
        {
          id: '2',
          disposition: 'reject',
          tag: null,
          reasons: [],
          score: 80,
          alt_zh: '',
          alt_en: '',
        },
        {
          id: '3',
          disposition: 'reject',
          tag: null,
          reasons: ['wrong_brand'],
          score: 10,
          alt_zh: '',
          alt_en: '',
        },
      ],
    }))

    expect(verdicts.get('1')).toMatchObject({ disposition: 'keep', tag: 'logo' })
    expect(verdicts.has('2')).toBe(false)
    expect(verdicts.get('3')).toMatchObject({
      disposition: 'reject',
      tag: null,
      reasons: ['wrong_brand'],
    })
  })

  it('demotes a keep that scores below the quality floor', () => {
    const verdicts = parseClassificationBatch(JSON.stringify({
      classifications: [
        {
          id: '1',
          disposition: 'keep',
          tag: 'product',
          reasons: [],
          score: MIN_KEEP_SCORE - 1,
          alt_zh: '模糊的產品照',
          alt_en: 'Blurry product photo',
        },
        {
          id: '2',
          disposition: 'keep',
          tag: 'product',
          reasons: [],
          score: MIN_KEEP_SCORE,
          alt_zh: '產品照',
          alt_en: 'Product photo',
        },
      ],
    }))

    // The floor is enforced here, not in the prompt, so it can be swept against
    // stored scores without re-calling the model.
    expect(verdicts.get('1')).toMatchObject({
      disposition: 'reject',
      tag: null,
      reasons: ['low_visual_quality'],
      score: MIN_KEEP_SCORE - 1,
    })
    expect(verdicts.get('2')).toMatchObject({ disposition: 'keep', tag: 'product' })
  })

  it.each(['lifestyle', 'packaging'])(
    'still parses a legacy %s row as a kept product image',
    (legacyTag) => {
      const verdicts = parseClassificationBatch(JSON.stringify({
        classifications: [
          {
            id: '1',
            disposition: 'keep',
            tag: legacyTag,
            reasons: [],
            score: 84,
            alt_zh: '產品照',
            alt_en: 'Product photo',
          },
        ],
      }))

      // Narrowing KEEP_TAGS must not turn old rows into null verdicts, which
      // would silently make them hero-ineligible.
      expect(verdicts.get('1')).toMatchObject({
        disposition: 'keep',
        tag: 'product',
      })
    },
  )

  it('infers keep from a legacy row that carries no disposition field', () => {
    const verdicts = parseClassificationBatch(JSON.stringify({
      classifications: [
        { id: '1', tag: 'packaging', score: 77, alt_zh: '包裝', alt_en: 'Packaging' },
      ],
    }))

    expect(verdicts.get('1')).toMatchObject({
      disposition: 'keep',
      tag: 'product',
      reasons: [],
    })
  })

  it('maps the legacy promo tag to an explicit rejection reason', () => {
    const verdicts = parseClassificationBatch(JSON.stringify({
      classifications: [
        { id: '1', tag: 'promo', score: 40, alt_zh: '', alt_en: '' },
      ],
    }))

    expect(verdicts.get('1')).toMatchObject({
      disposition: 'reject',
      tag: null,
      reasons: ['promo_subject'],
    })
  })
})
