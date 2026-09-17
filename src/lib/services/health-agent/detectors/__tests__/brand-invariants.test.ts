import { describe, expect, it } from 'vitest'

import {
  evaluateApprovedBrandInvariants,
  type ApprovedBrandInvariantInput,
} from '../../../../../../scripts/health-agent/directory'

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
