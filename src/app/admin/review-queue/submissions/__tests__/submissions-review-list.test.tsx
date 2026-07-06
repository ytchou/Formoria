// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrandSubmission } from '@/lib/types'
import messages from '../../../../../../messages/zh-TW.json'
import { getEnrichmentStatus, SubmissionsReviewList } from '../submissions-review-list'
import { startCurationJobAction } from '@/app/admin/operations/actions'
import { toast } from 'sonner'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}))

vi.mock('@/app/admin/actions', () => ({
  rejectSubmissionAction: vi.fn(),
}))

vi.mock('../actions', () => ({
  approveSubmissionWithOverridesAction: vi.fn(),
}))

vi.mock('@/app/admin/operations/actions', () => ({
  startCurationJobAction: vi.fn(),
  getCurationJobAction: vi.fn(),
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
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  )
}

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
    sourceAttribution: null,
    ...overrides,
  }
}

function renderReviewList() {
  return renderWithIntl(
    <SubmissionsReviewList submissions={[makeSubmission()]} />
  )
}

function renderReviewListWithSubmissions(submissions: BrandSubmission[]) {
  return renderWithIntl(
    <SubmissionsReviewList submissions={submissions} />
  )
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
  return within(getExpandedSubmissionRow(brandName)).getByRole('button', { name })
}

function getBulkRejectButton() {
  const button = screen.getAllByRole('button', { name: '拒絕' })[0]
  expect(button).toBeDefined()
  return button as HTMLElement
}

async function expandAndStartReject() {
  const user = userEvent.setup()
  renderReviewList()

  const row = getSubmissionRow('Test Brand')
  await user.click(within(row).getByText('Test Brand'))
  await user.click(getExpandedRowActionButton('Test Brand', '拒絕'))

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
      name: /批次拒絕原因/,
    })
    expect(reasonSelect).toBeInTheDocument()

    await user.click(reasonSelect)
    expect(await screen.findByRole('option', { name: '非台灣製造' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '資訊不足' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '重複提交' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '違反政策' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '其他' })).not.toBeInTheDocument()
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

    expect(
      screen.getByRole('button', { name: '確認批次拒絕' })
    ).toBeDisabled()
  })
})

describe('SubmissionsReviewList — bulk enrichment', () => {
  it('shows queued toast and clears selected submissions', async () => {
    vi.mocked(startCurationJobAction).mockResolvedValueOnce({
      queued: true,
      jobIds: ['job-1'],
      message: 'Queued 1 curation job.',
    })
    const user = userEvent.setup()
    renderReviewList()

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])
    await user.click(screen.getByRole('button', { name: '抓取資料' }))

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith('Queued 1 curation job.')
    })
    expect(checkboxes[1]).not.toBeChecked()
  })
})

describe('SubmissionsReviewList rejection reasons', () => {
  it('shows denial reason dropdown when reject is clicked', async () => {
    const user = await expandAndStartReject()
    const expandedRow = getExpandedSubmissionRow('Test Brand')

    const reasonSelect = within(expandedRow).getByRole('combobox', {
      name: /拒絕原因/,
    })
    expect(reasonSelect).toBeInTheDocument()

    await user.click(reasonSelect)
    // Use findByRole (async) because Radix UI Select renders options into a
    // portal after pointer events settle; getByRole would race the open state.
    expect(await screen.findByRole('option', { name: '非台灣製造' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '資訊不足' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '重複提交' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '違反政策' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '其他' })).toBeInTheDocument()
  })

  it('disables confirm button until reason is selected', async () => {
    await expandAndStartReject()
    const expandedRow = getExpandedSubmissionRow('Test Brand')

    expect(
      within(expandedRow).getByRole('button', {
        name: '確認拒絕',
      })
    ).toBeDisabled()
  })

  it('requires notes when Other reason is selected', async () => {
    const user = await expandAndStartReject()
    const expandedRow = getExpandedSubmissionRow('Test Brand')

    await user.click(
      within(expandedRow).getByRole('combobox', { name: /拒絕原因/ })
    )
    await user.click(await screen.findByRole('option', { name: '其他' }))

    expect(
      within(expandedRow).getByPlaceholderText('補充說明（必填）')
    ).toBeInTheDocument()
  })
})
