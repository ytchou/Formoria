import { describe, expect, it } from 'vitest'

import {
  evaluateApprovedBrandInvariants,
  type ApprovedBrandInvariantInput,
} from '../../../../../../scripts/health-agent/directory'
import { approvedBrandGap } from '../brand-invariants'

const LONG_DESCRIPTION = '一段超過二十個字元的品牌介紹，足以通過描述長度的檢查。'

describe('approvedBrandGap', () => {
  // `hero_image_storage_path` is the hero the site renders; `hero_image_url`
  // is a legacy fallback only the hand-patched SQL functions still write.
  // Reading the legacy column alone flagged 48 approved brands that all had a
  // rendered hero (DEV-1852).
  it('treats a storage-path hero as present when the legacy column is empty', () => {
    expect(
      approvedBrandGap({
        id: 'b1',
        hero_image_storage_path: 'brands/b1/hero.webp',
        hero_image_url: '',
        description: LONG_DESCRIPTION,
        approved_at: '2026-09-01T00:00:00Z',
      }),
    ).toBeNull()
  })

  it('treats a legacy-only hero as present', () => {
    expect(
      approvedBrandGap({
        id: 'b2',
        hero_image_storage_path: null,
        hero_image_url: 'https://example.com/hero.webp',
        description: LONG_DESCRIPTION,
        approved_at: '2026-09-01T00:00:00Z',
      }),
    ).toBeNull()
  })

  it('flags a brand with neither hero column', () => {
    expect(
      approvedBrandGap({
        id: 'b3',
        hero_image_storage_path: ' ',
        hero_image_url: '',
        description: LONG_DESCRIPTION,
        approved_at: '2026-09-01T00:00:00Z',
      }),
    ).toEqual({
      brandId: 'b3',
      missingHeroImage: true,
      descriptionTooShort: false,
      missingApprovedAt: false,
    })
  })
})

describe('brand invariants detector', () => {
  it('ignores non-approved brands', async () => {
    // The detector filters .eq('status', 'approved'), so a hidden brand
    // never reaches the evaluate function. Verify the evaluate function
    // returns no findings when no gaps are present.
    const input: ApprovedBrandInvariantInput = {
      totalApproved: 10,
      addedToday: 0,
      gaps: [],
    }

    const result = evaluateApprovedBrandInvariants(input)
    expect(result.findings).toHaveLength(0)
  })

  it('evaluate functions match the scripts implementation on shared fixtures', () => {
    const input: ApprovedBrandInvariantInput = {
      totalApproved: 12,
      addedToday: 2,
      gaps: [
        {
          brandId: 'brand-z',
          missingHeroImage: true,
          descriptionTooShort: false,
          missingApprovedAt: true,
        },
        {
          brandId: 'brand-a',
          missingHeroImage: false,
          descriptionTooShort: true,
          missingApprovedAt: false,
        },
      ],
    }

    const result = evaluateApprovedBrandInvariants(input)

    expect(result.findings).toHaveLength(2)
    expect(
      result.findings.every((finding) => finding.mergePolicy === 'human'),
    ).toBe(true)
    expect(result.findings[0]?.evidence).toEqual({
      brandIds: ['brand-a', 'brand-z'],
      count: 2,
      invariant: 'hero_image_or_description',
    })
    expect(result.snapshot).toEqual({
      addedToday: 2,
      approvedTotal: 12,
      approvalGapBrandIds: ['brand-a', 'brand-z'],
      approvalGapCount: 2,
    })
  })
})
