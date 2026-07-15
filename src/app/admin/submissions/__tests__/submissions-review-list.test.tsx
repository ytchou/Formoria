// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrandSubmission } from '@/lib/types'
import type { EnrichedData } from '@/lib/types/enriched-data'
import messages from '../../../../../messages/en.json'
import { getEnrichmentStatus, SubmissionsReviewList, type TabValue } from '../submissions-review-list'
import { startCurationJobAction } from '@/app/admin/operations/actions'
import { toast } from 'sonner'

const navigationMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: navigationMocks.refresh,
    push: navigationMocks.push,
    replace: navigationMocks.replace,
  }),
  usePathname: () => '/admin/submissions',
}))

vi.mock('@/app/admin/actions', () => ({
  rejectSubmissionAction: vi.fn(),
}))

vi.mock('../actions', () => ({
  approveSubmissionWithOverridesAction: vi.fn(),
}))

vi.mock('@/app/admin/operations/actions', () => ({
  startCurationJobAction: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function renderWithIntl(ui: Parameters<typeof render>[0]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  )
}

type ReviewSubmission = BrandSubmission & {
  enriched_data?: EnrichedData | null
  latestCurationTargetStatus?: 'pending' | 'running' | 'succeeded' | 'skipped' | 'failed' | null
  latestCurationJobId?: string | null
  latestCurationPhase?: string | null
  latestCurationError?: string | null
  latestCurationJobStatus?: string | null
  latestCurationDispatchStatus?: 'pending' | 'dispatched' | 'failed' | null
  reviewStage: 'needs_data' | 'enriching' | 'ready' | 'approved' | 'rejected'
}

function makeSubmission(overrides: Partial<ReviewSubmission> = {}): ReviewSubmission {
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
    intent: 'owner_claim',
    isBrandOwner: true,
    sourceAttribution: null,
    reviewStage: 'needs_data',
    ...overrides,
  }
}

function renderReviewList(initialTab: TabValue = 'needs_data') {
  return renderWithIntl(<SubmissionsReviewList submissions={[makeSubmission()]} initialTab={initialTab} />)
}

function renderReviewListWithSubmissions(
  submissions: ReviewSubmission[],
  initialTab: TabValue = 'needs_data',
) {
  return renderWithIntl(<SubmissionsReviewList submissions={submissions} initialTab={initialTab} />)
}

function getSubmissionRow(brandName: string) {
  const row = screen.getByText(brandName).closest('tr')
  expect(row).not.toBeNull()
  return row as HTMLElement
}

function getExpandedSubmissionRow(brandName: string) {
  const expandedRow = getSubmissionRow(brandName).nextElementSibling
  expect(expandedRow).not.toBeNull()
  return expandedRow as HTMLElement
}

function getExpandedRowActionButton(brandName: string, name: string | RegExp) {
  return within(getExpandedSubmissionRow(brandName)).getByRole('button', {
    name,
  })
}

function getBulkRejectButton() {
  const button = screen.getAllByRole('button', { name: 'Reject' })[0]
  expect(button).toBeDefined()
  return button as HTMLElement
}

async function expandAndStartReject() {
  const user = userEvent.setup()
  renderReviewList()

  const row = getSubmissionRow('Test Brand')
  await user.click(within(row).getByText('Test Brand'))
  await user.click(getExpandedRowActionButton('Test Brand', 'Reject'))

  return user
}

describe('getEnrichmentStatus from enriched_data', () => {
  it('returns not_enriched when enriched_data is null', () => {
    const status = getEnrichmentStatus(null)
    expect(status).toBe('not_enriched')
  })

  it('returns partially_enriched when only some fields are present', () => {
    const status = getEnrichmentStatus({
      description: 'A brand',
    })
    expect(status).toBe('partially_enriched')
  })

  it('returns enriched when all key fields are present', () => {
    const status = getEnrichmentStatus({
      description: 'A brand',
      heroImageUrl: 'https://example.com/hero.jpg',
      productType: 'crafts',
    })
    expect(status).toBe('enriched')
  })
})

describe('SubmissionsReviewList — enrichment approval gate', () => {
  it('defaults to the human-review stage and only exposes approval for complete enrichment', () => {
    renderReviewListWithSubmissions([
      makeSubmission({
        id: 'ready-submission',
        brandName: 'Ready Brand',
        heroImageUrl: 'https://example.com/ready.jpg',
        enriched_data: {
          description: 'A complete description',
          heroImageUrl: 'https://example.com/ready.jpg',
          productType: 'crafts',
        },
        latestCurationTargetStatus: 'succeeded',
        reviewStage: 'ready',
      }),
      makeSubmission({ id: 'partial-submission', brandName: 'Partial Brand' }),
    ], 'ready')

    expect(screen.getByText('Ready Brand')).toBeInTheDocument()
    expect(screen.queryByText('Partial Brand')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Approve' }).some((button) => !button.hasAttribute('disabled'))).toBe(true)
  })

  it('keeps a failed target in data work and links its tracked job', () => {
    renderReviewListWithSubmissions([
      makeSubmission({
        brandName: 'Needs Rerun',
        enriched_data: {
          description: 'Partial description',
        },
        latestCurationTargetStatus: 'failed',
        latestCurationJobId: 'failed-job',
        latestCurationError: 'Provider timeout',
      }),
    ], 'needs_data')

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View job' })).toHaveAttribute(
      'href',
      '/admin/jobs/failed-job',
    )
    expect(screen.getAllByRole('button', { name: 'Approve' }).every((button) => button.hasAttribute('disabled'))).toBe(true)
  })

  it('does not label a target as running after its parent job failed', () => {
    renderReviewListWithSubmissions([
      makeSubmission({
        brandName: 'Stopped Enrichment',
        latestCurationTargetStatus: 'running',
        latestCurationJobStatus: 'failed',
        reviewStage: 'needs_data',
      }),
    ])

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.queryByText('Running')).not.toBeInTheDocument()
  })
})

describe('SubmissionsReviewList — bulk rejection', () => {
  it('shows reason dropdown with 4 presets only (no Other) for bulk reject', async () => {
    const user = userEvent.setup()
    renderReviewListWithSubmissions([
      makeSubmission({ id: 'submission-1', brandName: 'First Brand' }),
      makeSubmission({ id: 'submission-2', brandName: 'Second Brand' }),
    ])

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])
    await user.click(checkboxes[2])
    await user.click(getBulkRejectButton())

    const reasonSelect = screen.getByRole('combobox', {
      name: /Bulk rejection reason/i,
    })
    expect(reasonSelect).toBeInTheDocument()

    await user.click(reasonSelect)
    expect(await screen.findByRole('option', { name: 'Not Made in Taiwan' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Insufficient Information' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Duplicate Submission' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Policy Violation' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Other' })).not.toBeInTheDocument()
  })

  it('disables bulk reject confirm until reason is selected', async () => {
    const user = userEvent.setup()
    renderReviewListWithSubmissions([
      makeSubmission({ id: 'submission-1', brandName: 'First Brand' }),
      makeSubmission({ id: 'submission-2', brandName: 'Second Brand' }),
    ])

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])
    await user.click(checkboxes[2])
    await user.click(getBulkRejectButton())

    expect(screen.getByRole('button', { name: 'Confirm Bulk Reject' })).toBeDisabled()
  })
})

describe('SubmissionsReviewList — bulk enrichment', () => {
  it('shows queued toast and clears selected submissions', async () => {
    vi.mocked(startCurationJobAction).mockResolvedValueOnce({
      queued: true,
      jobId: 'job-1',
      detailPath: '/admin/jobs/job-1',
      dispatchStatus: 'dispatched',
      message: 'Queued 1 curation job.',
    })
    const user = userEvent.setup()
    renderReviewList()

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])
    await user.click(screen.getByRole('button', { name: 'Fetch Data' }))

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        'Queued 1 curation job.',
        expect.objectContaining({
          action: expect.objectContaining({ label: 'View job' }),
        })
      )
    })
    expect(navigationMocks.replace).toHaveBeenCalledWith(
      '/admin/submissions?stage=enriching',
    )
  })

  it('keeps a dispatch failure in needs data', async () => {
    vi.mocked(startCurationJobAction).mockResolvedValueOnce({
      queued: true,
      jobId: 'job-1',
      detailPath: '/admin/jobs/job-1',
      dispatchStatus: 'failed',
      message: 'Dispatch failed.',
    })
    const user = userEvent.setup()
    renderReviewList()

    const submissionCheckbox = screen.getAllByRole('checkbox').at(1)
    if (!submissionCheckbox) throw new Error('Submission checkbox not found')
    await user.click(submissionCheckbox)
    await user.click(screen.getByRole('button', { name: 'Fetch Data' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(navigationMocks.replace).not.toHaveBeenCalledWith(
      '/admin/submissions?stage=enriching',
    )
  })
})

describe('SubmissionsReviewList rejection reasons', () => {
  it('shows denial reason dropdown when reject is clicked', async () => {
    const user = await expandAndStartReject()
    const expandedRow = getExpandedSubmissionRow('Test Brand')

    const reasonSelect = within(expandedRow).getByRole('combobox', {
      name: /Rejection reason/i,
    })
    expect(reasonSelect).toBeInTheDocument()

    await user.click(reasonSelect)
    // Use findByRole (async) because Radix UI Select renders options into a
    // portal after pointer events settle; getByRole would race the open state.
    expect(await screen.findByRole('option', { name: 'Not Made in Taiwan' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Insufficient Information' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Duplicate Submission' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Policy Violation' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Other' })).toBeInTheDocument()
  })

  it('disables confirm button until reason is selected', async () => {
    await expandAndStartReject()
    const expandedRow = getExpandedSubmissionRow('Test Brand')

    expect(
      within(expandedRow).getByRole('button', {
        name: 'Confirm Reject',
      })
    ).toBeDisabled()
  })

  it('requires notes when Other reason is selected', async () => {
    const user = await expandAndStartReject()
    const expandedRow = getExpandedSubmissionRow('Test Brand')

    await user.click(within(expandedRow).getByRole('combobox', { name: /Rejection reason/i }))
    await user.click(await screen.findByRole('option', { name: 'Other' }))

    expect(within(expandedRow).getByPlaceholderText('Additional notes (required)')).toBeInTheDocument()
  })
})
