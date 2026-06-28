// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AdminDashboardPage from '../page'
import { getBrands } from '@/lib/services/brands'
import { listClaimRequests } from '@/lib/services/claim-requests'
import { getFeedbackItems } from '@/lib/services/feedback'
import { getFlaggedContent } from '@/lib/services/moderation'
import { getPendingEdits } from '@/lib/services/pending-edits'
import { getPendingReports } from '@/lib/services/reports'
import { getSubmissions } from '@/lib/services/submissions'
import { getTags } from '@/lib/services/taxonomy'
import type { BrandReport } from '@/lib/services/reports'
import type { FeedbackItem } from '@/lib/services/feedback'
import type { FlaggedContentItem } from '@/lib/services/moderation'
import type { BrandSubmission } from '@/lib/types'
import type { PendingBrandEditWithBrand } from '@/lib/types/brand'
import type { ClaimRequest } from '@/lib/services/claim-requests'
import type { Brand, TaxonomyTag } from '@/lib/types'

vi.mock('@/lib/services/submissions', () => ({
  getSubmissions: vi.fn(),
}))

vi.mock('@/lib/services/pending-edits', () => ({
  getPendingEdits: vi.fn(),
}))

vi.mock('@/lib/services/claim-requests', () => ({
  listClaimRequests: vi.fn(),
}))

vi.mock('@/lib/services/reports', () => ({
  getPendingReports: vi.fn(),
}))

vi.mock('@/lib/services/feedback', () => ({
  getFeedbackItems: vi.fn(),
}))

vi.mock('@/lib/services/moderation', () => ({
  getFlaggedContent: vi.fn(),
}))

vi.mock('@/lib/services/brands', () => ({
  getBrands: vi.fn(),
}))

vi.mock('@/lib/services/taxonomy', () => ({
  getTags: vi.fn(),
}))

vi.mock('@/app/admin/actions', () => ({
  approveSubmissionAction: vi.fn(),
  approvePendingEditAction: vi.fn(),
  approveClaimAction: vi.fn(),
  reviewReportAction: vi.fn(),
  reviewFeedbackAction: vi.fn(),
}))

function makeSubmission(overrides: Partial<BrandSubmission> = {}): BrandSubmission {
  return {
    id: 'submission-1',
    brandId: 'brand-1',
    brandName: 'Sunrise Studio',
    submitterEmail: 'submitter@example.com',
    submitterName: null,
    description: null,
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
    submittedAt: '2026-06-13T02:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    pdpaConsentAt: null,
    validationStatus: null,
    validationErrors: null,
    notifiedAt: null,
    isBrandOwner: false,
    sourceAttribution: null,
    ...overrides,
  }
}

function makePendingEdit(overrides: Partial<PendingBrandEditWithBrand> = {}): PendingBrandEditWithBrand {
  return {
    id: 'edit-1',
    brandId: 'brand-2',
    submittedBy: 'owner-1',
    proposedData: {},
    status: 'pending',
    reviewerNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: '2026-06-13T03:00:00.000Z',
    updatedAt: '2026-06-13T03:00:00.000Z',
    brand: {
      id: 'brand-2',
      name: 'Quiet Goods',
      slug: 'quiet-goods',
      description: null,
      heroImageUrl: null,
      category: null,
      contactEmail: 'owner@example.com',
      foundingYear: null,
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
      purchaseWebsite: null,
      purchasePinkoi: null,
      purchaseShopee: null,
      otherUrls: [],
      retailLocations: [],
      productPhotos: [],
      siteContent: null,
    priceRange: null,
    productTags: [],
    },
    ...overrides,
  }
}

function makeClaim(overrides: Partial<ClaimRequest> = {}): ClaimRequest {
  return {
    id: 'claim-1',
    brandId: 'brand-3',
    userId: 'user-1',
    proofType: 'domain_email',
    proofUrl: 'owner@example.com',
    proofNotes: null,
    proofEvidence: [{ type: 'domain_email', url: 'owner@example.com' }],
    mitSmileCert: null,
    status: 'pending',
    reviewerNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: '2026-06-13T04:00:00.000Z',
    brandName: 'Claimed Co',
    brandSlug: 'claimed-co',
    requesterEmail: 'owner@example.com',
    ...overrides,
  }
}

function makeReport(overrides: Partial<BrandReport> = {}): BrandReport {
  return {
    id: 'report-1',
    brandId: 'brand-4',
    brandName: 'Report Brand',
    brandSlug: 'report-brand',
    reason: 'incorrect_info',
    notes: 'Wrong address',
    status: 'pending',
    reviewedAt: null,
    createdAt: '2026-06-13T05:00:00.000Z',
    ...overrides,
  }
}

function makeFeedback(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: 'feedback-1',
    source: 'tally',
    type: 'feedback',
    title: 'Search issue',
    body: 'Could not find a brand',
    url: null,
    status: 'open',
    userEmail: 'reader@example.com',
    sentryEventId: null,
    sentryFeedbackId: null,
    tallyResponseId: 'response-1',
    metadata: {},
    reviewedAt: null,
    createdAt: '2026-06-13T06:00:00.000Z',
    ...overrides,
  }
}

function makeFlag(overrides: Partial<FlaggedContentItem> = {}): FlaggedContentItem {
  return {
    id: 'flag-1',
    brandId: 'brand-5',
    brandName: 'Flagged Brand',
    fieldName: 'description',
    tier: 'block',
    reason: 'Suspicious TLD detected: .tk',
    flaggedContent: 'https://example.tk',
    status: 'pending',
    createdAt: '2026-06-13T07:00:00.000Z',
    ...overrides,
  }
}

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'brand-1',
    name: 'Brand One',
    slug: 'brand-one',
    description: null,
    heroImageUrl: null,
    status: 'approved',
    category: null,
    isVerified: false,
    isDemo: false,
    foundingYear: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    otherUrls: [],
    retailLocations: [],
    productPhotos: [],
    contactEmail: null,
    siteContent: null,
    priceRange: null,
    productTags: [],
    tags: [],
    submittedAt: '2026-06-01T00:00:00.000Z',
    approvedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeTag(overrides: Partial<TaxonomyTag> = {}): TaxonomyTag {
  return {
    id: 'tag-1',
    name: 'Tea',
    nameZh: null,
    slug: 'tea',
    category: 'product_type',
    isActive: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    brandCount: 1,
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(getSubmissions).mockResolvedValue([])
  vi.mocked(getPendingEdits).mockResolvedValue([])
  vi.mocked(listClaimRequests).mockResolvedValue([])
  vi.mocked(getPendingReports).mockResolvedValue([])
  vi.mocked(getFeedbackItems).mockResolvedValue([])
  vi.mocked(getFlaggedContent).mockResolvedValue({ items: [], nextCursor: null })
  vi.mocked(getBrands).mockResolvedValue({
    brands: [],
    totalCount: 0,
  })
  vi.mocked(getTags).mockResolvedValue([])
})

describe('AdminPage', () => {
  it('renders queue summary cards sorted by highest pending count first', async () => {
    vi.mocked(getSubmissions).mockResolvedValueOnce([
      makeSubmission({ id: 'submission-1', brandName: 'First Submission' }),
      makeSubmission({ id: 'submission-2', brandName: 'Second Submission' }),
      makeSubmission({ id: 'submission-3', brandName: 'Third Submission' }),
    ])
    vi.mocked(getPendingEdits).mockResolvedValueOnce([
      makePendingEdit({ id: 'edit-1' }),
      makePendingEdit({ id: 'edit-2' }),
    ])
    vi.mocked(listClaimRequests).mockResolvedValueOnce([
      makeClaim({ id: 'claim-1' }),
      makeClaim({ id: 'claim-2' }),
      makeClaim({ id: 'claim-3' }),
      makeClaim({ id: 'claim-4' }),
    ])
    vi.mocked(getPendingReports).mockResolvedValueOnce([makeReport()])
    vi.mocked(getFeedbackItems).mockResolvedValueOnce([makeFeedback()])
    vi.mocked(getFlaggedContent).mockResolvedValueOnce({ items: [makeFlag()], nextCursor: null })

    render(await AdminDashboardPage())

    const cards = screen.getAllByTestId('queue-summary-card')
    expect(within(cards[0]).getByText('品牌認領')).toBeInTheDocument()
    expect(within(cards[0]).getByText('4')).toBeInTheDocument()
    expect(within(cards[1]).getByText('新品牌提交')).toBeInTheDocument()
    expect(within(cards[1]).getByText('3')).toBeInTheDocument()
    expect(within(cards[2]).getByText('品牌編輯')).toBeInTheDocument()
    expect(within(cards[2]).getByText('2')).toBeInTheDocument()
  })

  it('renders overview metrics for total brands and active tags', async () => {
    vi.mocked(getBrands).mockResolvedValueOnce({
      brands: [makeBrand()],
      totalCount: 42,
    })
    vi.mocked(getTags).mockResolvedValueOnce([
      makeTag({ id: 'tag-1', isActive: true }),
      makeTag({ id: 'tag-2', isActive: true }),
    ])

    render(await AdminDashboardPage())

    expect(screen.getByText('品牌總數')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('啟用標籤')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows empty collapsed state for zero-count queues', async () => {
    render(await AdminDashboardPage())

    expect(screen.getByText('目前沒有待審核的新品牌提交。')).toBeInTheDocument()
    expect(screen.getByText('目前沒有待審核的品牌編輯。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /核准|Approve/i })).not.toBeInTheDocument()
  })
})
