import { describe, it, expect } from 'vitest'
import { toBrandRow, toSubmissionRow } from '@/lib/services/field-map'

const brandInput = {
  name: '森之好物',
  slug: 'sen-zi-hao-wu',
  description: 'Taiwan-made home goods and accessories',
  heroImageUrl: 'https://cdn.example.com/hero.jpg',
  status: 'approved',
  category: 'home',
  productType: undefined,
  foundingYear: 2018,
  socialInstagram: '@senzi',
  socialThreads: 'https://threads.net/@senzi',
  socialFacebook: 'https://facebook.com/senzi',
  purchaseWebsite: 'https://senzi.tw',
  purchasePinkoi: 'https://pinkoi.com/store/senzi',
  purchaseShopee: 'https://shopee.tw/senzi',
  otherUrls: [{ label: 'Line', url: 'https://line.me/senzi' }],
  retailLocations: [{ name: 'Taipei flagship', address: 'No. 1, Xinyi Rd.' }],
  customerVoices: [{ author: 'Mina', quote: 'Lovely packaging.' }],
  productPhotos: ['https://cdn.example.com/product-1.jpg'],
  contactEmail: 'hello@senzi.tw',
  priceRange: 2,
  productTags: ['handmade', 'home'],
  isDemo: true,
}

const submissionInput = {
  brandId: 'brand-123',
  brandName: '森之好物',
  submitterEmail: 'submitter@example.com',
  submitterName: 'Jane Doe',
  description: 'Taiwan-made home goods and accessories',
  websiteUrl: 'https://senzi.tw/contact',
  heroImageUrl: 'https://cdn.example.com/submit-hero.jpg',
  productPhotos: ['https://cdn.example.com/product-1.jpg'],
  socialInstagram: '@senzi',
  socialThreads: 'https://threads.net/@senzi',
  socialFacebook: 'https://facebook.com/senzi',
  purchaseWebsite: 'https://senzi.tw',
  purchasePinkoi: 'https://pinkoi.com/store/senzi',
  purchaseShopee: 'https://shopee.tw/senzi',
  otherUrls: [{ label: 'Line', url: 'https://line.me/senzi' }],
  suggestedTags: ['organic', 'minimal'],
  status: 'approved',
  reviewerNotes: 'Looks good',
  pdpaConsentAt: '2026-07-01T10:00:00Z',
  validationStatus: 'valid',
  validationErrors: ['missing logo'],
  notifiedAt: '2026-07-01T11:00:00Z',
  isBrandOwner: true,
  sourceAttribution: 'manual',
  productTypeNote: 'derived from retail concept',
}

describe('field-map', () => {
  it('brands mapper output is byte-identical to pre-refactor fixture', () => {
    expect(toBrandRow(brandInput)).toEqual({
      name: '森之好物',
      slug: 'sen-zi-hao-wu',
      description: 'Taiwan-made home goods and accessories',
      hero_image_url: 'https://cdn.example.com/hero.jpg',
      status: 'approved',
      product_type: 'home',
      founding_year: 2018,
      social_instagram: '@senzi',
      social_threads: 'https://threads.net/@senzi',
      social_facebook: 'https://facebook.com/senzi',
      purchase_website: 'https://senzi.tw',
      purchase_pinkoi: 'https://pinkoi.com/store/senzi',
      purchase_shopee: 'https://shopee.tw/senzi',
      other_urls: [{ label: 'Line', url: 'https://line.me/senzi' }],
      retail_locations: [{ name: 'Taipei flagship', address: 'No. 1, Xinyi Rd.' }],
      customer_voices: [{ author: 'Mina', quote: 'Lovely packaging.' }],
      product_photos: ['https://cdn.example.com/product-1.jpg'],
      contact_email: 'hello@senzi.tw',
      price_range: 2,
      product_tags: ['handmade', 'home'],
      is_demo: true,
    })
  })

  it('maps mitStory to mit_story when present', () => {
    const result = toBrandRow({ mitStory: 'Our fabrics come from Changhua weaving mills.' })
    expect(result.mit_story).toBe('Our fabrics come from Changhua weaving mills.')
  })

  it('omits mit_story when mitStory is undefined', () => {
    const result = toBrandRow({ name: 'Test Brand' })
    expect('mit_story' in result).toBe(false)
  })

  it('sets mit_story to null when mitStory is null', () => {
    const result = toBrandRow({ mitStory: null })
    expect(result.mit_story).toBeNull()
  })

  it('submissions mapper shares the social/purchase block with brands', () => {
    const b = toBrandRow({
      ...brandInput,
      name: undefined,
      slug: undefined,
      description: undefined,
      heroImageUrl: undefined,
      status: undefined,
      category: undefined,
      productType: undefined,
      foundingYear: undefined,
      otherUrls: undefined,
      retailLocations: undefined,
      customerVoices: undefined,
      productPhotos: undefined,
      contactEmail: undefined,
      priceRange: undefined,
      productTags: undefined,
      isDemo: undefined,
    })
    const s = toSubmissionRow(submissionInput)

    expect(s.social_instagram).toEqual(b.social_instagram)
    expect(s.social_threads).toEqual(b.social_threads)
    expect(s.social_facebook).toEqual(b.social_facebook)
    expect(s.purchase_website).toEqual(b.purchase_website)
    expect(s.purchase_pinkoi).toEqual(b.purchase_pinkoi)
    expect(s.purchase_shopee).toEqual(b.purchase_shopee)
    expect(s).toEqual({
      brand_id: 'brand-123',
      brand_name: '森之好物',
      submitter_email: 'submitter@example.com',
      submitter_name: 'Jane Doe',
      description: 'Taiwan-made home goods and accessories',
      website_url: 'https://senzi.tw/contact',
      hero_image_url: 'https://cdn.example.com/submit-hero.jpg',
      product_photos: ['https://cdn.example.com/product-1.jpg'],
      social_instagram: '@senzi',
      social_threads: 'https://threads.net/@senzi',
      social_facebook: 'https://facebook.com/senzi',
      purchase_website: 'https://senzi.tw',
      purchase_pinkoi: 'https://pinkoi.com/store/senzi',
      purchase_shopee: 'https://shopee.tw/senzi',
      other_urls: [{ label: 'Line', url: 'https://line.me/senzi' }],
      suggested_tags: ['organic', 'minimal'],
      status: 'approved',
      reviewer_notes: 'Looks good',
      pdpa_consent_at: '2026-07-01T10:00:00Z',
      validation_status: 'valid',
      validation_errors: ['missing logo'],
      notified_at: '2026-07-01T11:00:00Z',
      is_brand_owner: true,
      source_attribution: 'manual',
      product_type_note: 'derived from retail concept',
    })
  })
})
