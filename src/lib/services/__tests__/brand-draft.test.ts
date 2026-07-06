import { describe, it, expect } from 'vitest'
import {
  brandToDraftSnapshot,
  draftSnapshotToDomain,
  mergeDraftOverBrand,
  diffRemovedImageUrls,
} from '../brands'
import type { Brand } from '@/lib/types/brand'

const liveBrand: Brand = {
  id: 'b1',
  name: 'Live Name',
  slug: 'live-name',
  description: 'live desc',
  heroImageUrl: 'https://x.supabase.co/hero-live.png',
  status: 'approved',
  category: 'apparel',
  city: null,
  isVerified: true,
  mitStatus: 'verified',
  mitVerifiedAt: '2026-01-01T00:00:00Z',
  mitEvidence: null,
  mitVerified: true,
  isDemo: false,
  foundingYear: 2019,
  socialInstagram: 'live_ig',
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: 'https://live.tw',
  purchasePinkoi: null,
  purchaseShopee: 'https://shopee.tw/live',
  otherUrls: [],
  retailLocations: [
    {
      name: 'Live Store',
      address: 'Taipei',
      latitude: 25.033,
      longitude: 121.5654,
    },
  ],
  productPhotos: ['https://x.supabase.co/p-live-1.png'],
  contactEmail: 'live@brand.tw',
  mitStory: 'Our fabrics come from Changhua.',
  siteContent: null,
  priceRange: null,
  productTags: [],
  submittedAt: '2026-01-01T00:00:00Z',
  approvedAt: '2026-01-02T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
}

describe('brandToDraftSnapshot', () => {
  it('captures only allow-listed editable fields, never id/slug/status', () => {
    const snap = brandToDraftSnapshot({
      name: 'New Name',
      description: 'new desc',
    } as Partial<Brand>)
    expect(snap.name).toBe('New Name')
    expect(snap.description).toBe('new desc')
    expect(snap).not.toHaveProperty('id')
    expect(snap).not.toHaveProperty('slug')
    expect(snap).not.toHaveProperty('status')
    expect(snap).not.toHaveProperty('isVerified')
  })
})

describe('mergeDraftOverBrand', () => {
  it('overlays editable fields, preserves identity/status/mit', () => {
    const snap = brandToDraftSnapshot({ name: 'Draft Name' } as Partial<Brand>)
    const merged = mergeDraftOverBrand(liveBrand, snap)
    expect(merged.name).toBe('Draft Name')
    expect(merged.id).toBe('b1')
    expect(merged.slug).toBe('live-name')
    expect(merged.status).toBe('approved')
    expect(merged.mitStatus).toBe('verified')
  })

  it('returns the live brand unchanged when snapshot is null', () => {
    expect(mergeDraftOverBrand(liveBrand, null)).toEqual(liveBrand)
  })

  it('ignores unknown snapshot keys (schema-drift tolerant)', () => {
    const merged = mergeDraftOverBrand(liveBrand, {
      name: 'D',
      legacyRemovedField: 'x',
    })
    expect(merged.name).toBe('D')
    expect(merged).not.toHaveProperty('legacyRemovedField')
  })
})

describe('draftSnapshotToDomain', () => {
  it('normalizes flat social link fields', () => {
    const partial = draftSnapshotToDomain(
      { purchaseWebsite: 'https://d.tw', socialInstagram: 'd_ig' },
      liveBrand,
    )
    expect(partial.purchaseWebsite).toBe('https://d.tw')
    expect(partial.socialInstagram).toBe('d_ig')
  })

  it('defaults missing array fields to empty arrays', () => {
    const snapshot: Record<string, unknown> = {
      name: 'Test Brand',
      // productPhotos, otherUrls, retailLocations, productTags all absent
    }
    const result = draftSnapshotToDomain(snapshot)
    expect(result.productPhotos).toBeUndefined()
  })

  it('defaults null array fields to empty arrays when key is present', () => {
    const snapshot: Record<string, unknown> = {
      productPhotos: null,
      otherUrls: null,
      retailLocations: null,
      productTags: null,
    }
    const result = draftSnapshotToDomain(snapshot)
    expect(result.productPhotos).toEqual([])
    expect(result.otherUrls).toEqual([])
    expect(result.retailLocations).toEqual([])
    expect(result.productTags).toEqual([])
  })

  it('round-trips mitStory through draft snapshot', () => {
    const snapshot = brandToDraftSnapshot(liveBrand)
    const restored = draftSnapshotToDomain(snapshot, liveBrand)
    expect(restored.mitStory).toBe('Our fabrics come from Changhua.')
  })

  it('handles null mitStory in draft snapshot', () => {
    const brand = { ...liveBrand, mitStory: null }
    const snapshot = brandToDraftSnapshot(brand)
    const restored = draftSnapshotToDomain(snapshot, brand)
    expect(restored.mitStory).toBeNull()
  })
})

describe('diffRemovedImageUrls', () => {
  it('returns live image URLs no longer present in the next set (publish case)', () => {
    const removed = diffRemovedImageUrls(
      [
        'https://x.supabase.co/logo-live.png',
        'https://x.supabase.co/p-live-1.png',
      ],
      [
        'https://x.supabase.co/logo-new.png',
        'https://x.supabase.co/p-live-1.png',
      ],
    )
    expect(removed).toEqual(['https://x.supabase.co/logo-live.png'])
  })

  it('returns empty when nothing removed', () => {
    expect(diffRemovedImageUrls(['a'], ['a', 'b'])).toEqual([])
  })
})
