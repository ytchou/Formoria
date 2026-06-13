// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { SubmissionsList } from '../submissions-list'
import type { BrandSubmission } from '@/lib/types'
import messages from '../../../../messages/zh-TW.json'

type AdminSubmission = BrandSubmission & {
  productTypeNote: string | null
}

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

function makeSubmission(overrides: Partial<AdminSubmission> = {}): AdminSubmission {
  return {
    id: 'sub-1',
    brandId: null,
    brandName: 'Pottery Studio',
    submitterEmail: 'potter@test.com',
    submitterName: 'Potter',
    description: 'Handmade ceramics from Yingge',
    websiteUrl: null,
    status: 'pending',
    suggestedTags: ['ceramics'],
    socialLinks: {},
    submittedAt: '2026-05-18T10:00:00Z',
    reviewedAt: null,
    reviewedBy: null,
    reviewerNotes: null,
    pdpaConsentAt: null,
    validationStatus: null,
    validationErrors: null,
    notifiedAt: null,
    isBrandOwner: false,
    sourceAttribution: null,
    productTypeNote: null,
    ...overrides,
  }
}

const mockSubmissions = [
  {
    id: 'sub-1',
    brandId: null,
    brandName: 'Pottery Studio',
    submitterEmail: 'potter@test.com',
    submitterName: 'Potter',
    description: 'Handmade ceramics from Yingge',
    websiteUrl: null,
    status: 'pending' as const,
    suggestedTags: ['ceramics', 'handmade'],
    socialLinks: { instagram: '@pottery' },
    submittedAt: '2026-05-18T10:00:00Z',
    reviewedAt: null,
    reviewedBy: null,
    reviewerNotes: null,
    pdpaConsentAt: null,
    validationStatus: null,
    validationErrors: null,
    notifiedAt: null,
    isBrandOwner: false,
    productTypeNote: null,
  },
  {
    id: 'sub-2',
    brandId: null,
    brandName: 'Tea House',
    submitterEmail: 'tea@test.com',
    submitterName: null,
    description: 'Premium oolong tea',
    websiteUrl: null,
    status: 'approved' as const,
    suggestedTags: ['tea'],
    socialLinks: {},
    submittedAt: '2026-05-17T10:00:00Z',
    reviewedAt: '2026-05-18T10:00:00Z',
    reviewedBy: 'admin-1',
    reviewerNotes: null,
    pdpaConsentAt: null,
    validationStatus: null,
    validationErrors: null,
    notifiedAt: null,
    isBrandOwner: false,
    productTypeNote: null,
  },
] satisfies AdminSubmission[]

describe('SubmissionsList', () => {
  it('renders submission rows', () => {
    renderWithIntl(<SubmissionsList submissions={mockSubmissions} />)
    expect(screen.getByText('Pottery Studio')).toBeDefined()
    expect(screen.getByText('Tea House')).toBeDefined()
  })

  it('renders status filter tabs', () => {
    renderWithIntl(<SubmissionsList submissions={mockSubmissions} />)
    expect(screen.getByRole('tab', { name: /全部/ })).toBeDefined()
    expect(screen.getByRole('tab', { name: /待審核/ })).toBeDefined()
    expect(screen.getByRole('tab', { name: /已核准/ })).toBeDefined()
    expect(screen.getByRole('tab', { name: /已拒絕/ })).toBeDefined()
  })

  it('filters submissions by status tab', () => {
    renderWithIntl(<SubmissionsList submissions={mockSubmissions} />)
    const pendingTab = screen.getByRole('tab', { name: /待審核/ })
    fireEvent.click(pendingTab)
    expect(screen.getByText('Pottery Studio')).toBeDefined()
    expect(screen.queryByText('Tea House')).toBeNull()
  })

  it('expands a row when clicked', () => {
    renderWithIntl(<SubmissionsList submissions={mockSubmissions} />)
    fireEvent.click(screen.getByText('Pottery Studio'))
    expect(screen.getByText('Handmade ceramics from Yingge')).toBeDefined()
  })

  it('shows approve and reject buttons in expanded pending row', () => {
    renderWithIntl(<SubmissionsList submissions={mockSubmissions} />)
    fireEvent.click(screen.getByText('Pottery Studio'))
    expect(screen.getByRole('button', { name: '核准' })).toBeDefined()
    expect(screen.getByRole('button', { name: '拒絕' })).toBeDefined()
  })

  it('shows suggested tags in expanded row', () => {
    renderWithIntl(<SubmissionsList submissions={mockSubmissions} />)
    fireEvent.click(screen.getByText('Pottery Studio'))
    expect(screen.getByText('ceramics')).toBeDefined()
    expect(screen.getByText('handmade')).toBeDefined()
  })

  it('collapses previously expanded row when another is clicked (accordion)', () => {
    renderWithIntl(<SubmissionsList submissions={mockSubmissions} />)
    fireEvent.click(screen.getByText('Pottery Studio'))
    expect(screen.getByText('Handmade ceramics from Yingge')).toBeDefined()

    fireEvent.click(screen.getByText('Tea House'))
    expect(screen.queryByText('Handmade ceramics from Yingge')).toBeNull()
    expect(screen.getByText('Premium oolong tea')).toBeDefined()
  })
})

describe('source badge', () => {
  it('renders "Owner" badge when isBrandOwner is true', () => {
    renderWithIntl(<SubmissionsList submissions={[makeSubmission({ isBrandOwner: true })]} />)
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.queryByText('Community')).not.toBeInTheDocument()
  })

  it('renders "Community" badge when isBrandOwner is false', () => {
    renderWithIntl(<SubmissionsList submissions={[makeSubmission({ isBrandOwner: false })]} />)
    expect(screen.getByText('Community')).toBeInTheDocument()
    expect(screen.queryByText('Owner')).not.toBeInTheDocument()
  })
})

describe('sourceAttribution in expanded row', () => {
  it('shows attribution label when isBrandOwner is false and sourceAttribution is set', async () => {
    const submission = makeSubmission({ isBrandOwner: false, sourceAttribution: 'bought_product' })
    renderWithIntl(<SubmissionsList submissions={[submission]} />)
    await userEvent.click(screen.getByText(submission.brandName))
    expect(screen.getByText('How do you know this brand?')).toBeInTheDocument()
  })

  it('does not show attribution label when isBrandOwner is true', async () => {
    const submission = makeSubmission({ isBrandOwner: true, sourceAttribution: null })
    renderWithIntl(<SubmissionsList submissions={[submission]} />)
    await userEvent.click(screen.getByText(submission.brandName))
    expect(screen.queryByText('How do you know this brand?')).not.toBeInTheDocument()
  })
})

describe('admin helper text', () => {
  it('renders the submissions table without helper text', () => {
    renderWithIntl(<SubmissionsList submissions={[]} />)
    // Helper text was removed from submissions-list in admin UI cleanup
    expect(
      screen.queryByText(/Community submissions may have incomplete info/i)
    ).not.toBeInTheDocument()
  })
})

describe('taxonomy gap badge', () => {
  it('shows no taxonomy gap badge when productTypeNote is null', async () => {
    const submission = makeSubmission({ productTypeNote: null })
    renderWithIntl(<SubmissionsList submissions={[submission]} />)
    await userEvent.click(screen.getByText(submission.brandName))
    expect(screen.queryByText(/Taxonomy gap|taxonomy gap|分類缺口/i)).not.toBeInTheDocument()
  })

  it('shows taxonomy gap badge when productTypeNote is present', async () => {
    const submission = makeSubmission({ productTypeNote: '手工皮件' })
    renderWithIntl(<SubmissionsList submissions={[submission]} />)
    await userEvent.click(screen.getByText(submission.brandName))
    expect(screen.getByText(/Taxonomy gap|分類缺口/i)).toBeInTheDocument()
  })

  it('displays the free-text note content alongside the badge', async () => {
    const submission = makeSubmission({ productTypeNote: '手工皮件' })
    renderWithIntl(<SubmissionsList submissions={[submission]} />)
    await userEvent.click(screen.getByText(submission.brandName))
    expect(screen.getByText('手工皮件')).toBeInTheDocument()
  })
})
