// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import type { BrandSubmission } from '@/lib/types'
import { SubmissionsList } from './submissions-list'
import messages from '../../../messages/zh-TW.json'

function renderWithIntl(ui: Parameters<typeof render>[0]) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  )
}

vi.mock('@/app/admin/actions', () => ({
  approveSubmissionAction: vi.fn(),
  rejectSubmissionAction: vi.fn(),
}))

function makeSubmission(
  overrides: Partial<BrandSubmission> = {}
): BrandSubmission {
  return {
    id: 'submission-1',
    brandId: null,
    brandName: 'Test Brand',
    submitterEmail: 'submitter@example.com',
    submitterName: null,
    description: 'A brand submission description.',
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    otherUrls: [],
    suggestedTags: [],
    status: 'pending',
    reviewerNotes: null,
    submittedAt: '2026-06-13T00:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    pdpaConsentAt: null,
    validationStatus: null,
    validationErrors: null,
    notifiedAt: null,
    isBrandOwner: true,
    ...overrides,
  }
}

describe('SubmissionsList', () => {
  it('does not show unified business number label', async () => {
    const user = userEvent.setup()

    renderWithIntl(<SubmissionsList submissions={[makeSubmission()]} taxonomyTags={[]} />)

    await user.click(screen.getByText('Test Brand'))

    expect(screen.queryByText('統一編號：')).not.toBeInTheDocument()
  })
})
