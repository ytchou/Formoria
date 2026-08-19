import { describe, expect, it } from 'vitest'
import { enrichedDataFromDb, enrichedDataToDb } from '../enriched-data'

describe('enrichedDataFromDb', () => {
  it('maps price_range to priceRange', () => {
    expect(enrichedDataFromDb({ price_range: 2 })).toEqual({ priceRange: 2 })
  })

  it('maps subcategories to subcategories', () => {
    expect(enrichedDataFromDb({ subcategories: ['skincare', 'refillable'] })).toEqual({
      subcategories: ['skincare', 'refillable'],
    })
  })

  it('maps structured other_urls to OtherUrl values', () => {
    expect(
      enrichedDataFromDb({
        other_urls: [{ label: 'Stockist', url: 'https://stockist.example.com' }],
      }),
    ).toEqual({
      otherUrls: [{ label: 'Stockist', url: 'https://stockist.example.com' }],
    })
  })

  it('preserves expanded enrichment fields', () => {
    expect(
      enrichedDataFromDb({
        description_en: 'English description',
        blurb: '品牌摘要',
        blurb_en: 'Brand summary',
        city: '台北',
        reputation_summary: { text: '評價良好' },
        mit_evidence: { verified_source: 'enrichment_signal' },
        site_content: { title: 'Official site' },
        founding_year: 2020,
        subcategories_en: ['Handmade'],
      }),
    ).toEqual({
      descriptionEn: 'English description',
      blurb: '品牌摘要',
      blurbEn: 'Brand summary',
      city: '台北',
      reputationSummary: { text: '評價良好' },
      mitEvidence: { verified_source: 'enrichment_signal' },
      siteContent: { title: 'Official site' },
      foundingYear: 2020,
      subcategoriesEn: ['Handmade'],
    })
  })

  it('ignores the dropped category_attributes key on historical blobs', () => {
    expect(() =>
      enrichedDataFromDb({ city: '台北', category_attributes: { material: '皮革' } }),
    ).not.toThrow()
    expect(
      enrichedDataFromDb({ city: '台北', category_attributes: { material: '皮革' } }),
    ).toEqual({ city: '台北' })
  })
})

describe('enrichedDataToDb', () => {
  it('maps priceRange to price_range', () => {
    expect(enrichedDataToDb({ priceRange: 2 })).toEqual({ price_range: 2 })
  })

  it('maps subcategories to subcategories', () => {
    expect(enrichedDataToDb({ subcategories: ['skincare', 'refillable'] })).toEqual({
      subcategories: ['skincare', 'refillable'],
    })
  })

  it('writes expanded enrichment fields with database keys', () => {
    expect(
      enrichedDataToDb({
        descriptionEn: 'English description',
        blurb: '品牌摘要',
        blurbEn: 'Brand summary',
        city: '台北',
        reputationSummary: { text: '評價良好' },
        mitEvidence: { verified_source: 'enrichment_signal' },
        siteContent: { title: 'Official site' },
        foundingYear: 2020,
        subcategoriesEn: ['Handmade'],
      }),
    ).toEqual({
      description_en: 'English description',
      blurb: '品牌摘要',
      blurb_en: 'Brand summary',
      city: '台北',
      reputation_summary: { text: '評價良好' },
      mit_evidence: { verified_source: 'enrichment_signal' },
      site_content: { title: 'Official site' },
      founding_year: 2020,
      subcategories_en: ['Handmade'],
    })
  })
})
