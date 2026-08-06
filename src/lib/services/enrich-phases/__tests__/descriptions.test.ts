import { describe, expect, it } from 'vitest'
import { buildEnrichmentUserContent } from '../../description-rewrite'
import { CLEARED_FIELDS_KEY } from '@/lib/services/brand-write-policy'
import {
  buildDescriptionEvidence,
  preferPatched,
} from '../descriptions'
import type { EnrichBrand, EnrichPatch } from '../types'

const brand: EnrichBrand = {
  id: 'brand-1',
  slug: 'test-brand',
  name: 'Test Brand',
  purchase_website: 'https://smore.com',
  social_instagram: 'https://instagram.com/test-brand',
  purchase_shopee: 'https://shopee.tw/test-brand',
}

describe('preferPatched', () => {
  it('a revoked column is not resurrected from the stored value', () => {
    expect(
      preferPatched(
        { [CLEARED_FIELDS_KEY]: ['purchase_website'] } as unknown as EnrichPatch,
        'https://smore.com',
        'purchase_website',
      ),
    ).toBeNull()
  })

  it('an unrevoked absent column still falls back', () => {
    expect(
      preferPatched({}, '  https://stored.example  ', 'purchase_website'),
    ).toBe('https://stored.example')
  })
})

describe('description prompt behaviour', () => {
  it('the description prompt omits the revoked link', () => {
    const evidence = buildDescriptionEvidence(
      brand,
      { [CLEARED_FIELDS_KEY]: ['purchase_website'] } as unknown as EnrichPatch,
      [],
    )
    const { userContent } = buildEnrichmentUserContent(
      brand.name ?? '',
      null,
      [],
      null,
      evidence,
    )

    expect(userContent).not.toContain('smore.com')
    expect(userContent).toContain('instagram.com/test-brand')
    expect(userContent).toContain('shopee.tw/test-brand')
  })
})
