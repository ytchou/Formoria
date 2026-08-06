import { describe, expect, it } from 'vitest'
import {
  normalizeMatchKey,
  proposeExhibitorMatches,
} from './audit-event-exhibitors'
import type { EventExhibitorInput } from './seed-events'

function exhibitor(
  overrides: Partial<EventExhibitorInput> = {},
): EventExhibitorInput {
  return {
    sourceKey: 'creative-expo:322',
    name: '沃廚',
    nameEn: 'WOKY',
    booth: 'K1-001',
    area: '文創品牌展區',
    areaEn: 'Cultural & Creative Brands',
    zone: 'K1',
    eventCategory: 'cultural_creative',
    sourceUrl: 'https://creativexpo.tw/zh-TW/exhibitor_list/322',
    websiteUrl: 'https://woky.com.tw',
    verifiedAt: '2026-08-06',
    sortOrder: 0,
    reviewPriority: 'high',
    verificationEvidence: {
      sourceUrl: 'https://creativexpo.tw/zh-TW/exhibitor_list',
      detailUrl: 'https://creativexpo.tw/zh-TW/exhibitor_list/322',
      retrievedAt: '2026-08-06',
      basis: 'official listing',
    },
    outcome: 'included_unlinked',
    brandSlug: null,
    ...overrides,
  }
}

describe('event exhibitor audit', () => {
  it('normalizes punctuation and full-width variants before proposing a match', () => {
    // The audit must catch an exact identity hidden behind punctuation/case,
    // without mutating the human-reviewed ledger outcome.
    expect(normalizeMatchKey('WOKY．台灣 / Woky')).toBe('woky台灣woky')
  })

  it('reports ambiguous normalized-name candidates instead of approving one', () => {
    // Auto-choosing one of two same-name brands would silently repoint the
    // event. The audit can suggest both, but only a human may approve.
    const result = proposeExhibitorMatches(
      [exhibitor({ name: '春日', nameEn: null, websiteUrl: null })],
      [
        { slug: 'spring-one', name: '春日' },
        { slug: 'spring-two', name: '春日' },
      ],
    )

    expect(result[0]?.candidates).toEqual(['spring-one', 'spring-two'])
    expect(result[0]?.ambiguity).toBe('ambiguous')
  })
})
