import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createSubmission } = vi.hoisted(() => ({
  createSubmission: vi.fn().mockResolvedValue({ id: 'submission-1' }),
}))

vi.mock('@/lib/services/submissions', () => ({ createSubmission }))
vi.mock('@/lib/services/link-enrichment', () => ({
  classifySubmittedUrl: vi.fn(() => ({
    purchaseWebsite: 'https://classified.example.com',
  })),
}))

import { submitBrandForReview } from '../submission-pipeline'

describe('submitBrandForReview link mapping', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prefers an explicit purchase website and preserves custom links', async () => {
    await submitBrandForReview({
      brandName: 'Warmwood Living',
      websiteUrl: 'https://source.example.com',
      purchaseWebsite: 'https://warmwood.example.com/shop',
      otherUrls: [
        { label: 'Local stockist', url: 'https://stockist.example.com' },
      ],
      submitterEmail: 'owner@example.com',
    })

    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseWebsite: 'https://warmwood.example.com/shop',
        otherUrls: [
          { label: 'Local stockist', url: 'https://stockist.example.com' },
        ],
      }),
      undefined
    )
  })
})
