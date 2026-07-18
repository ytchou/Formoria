// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AdminDashboardPage from '../page'
import { getAppSetting } from '@/lib/services/app-settings'
import { getBrands } from '@/lib/services/brands'
import { listClaimRequests } from '@/lib/services/claim-requests'
import { getFeedbackItems } from '@/lib/services/feedback'
import { getFlaggedContent } from '@/lib/services/moderation'
import { getPendingEdits } from '@/lib/services/pending-edits'
import { getPendingReports } from '@/lib/services/reports'
import { getSubmissionsForReview, type BrandSubmissionForReview } from '@/lib/services/submissions'
import type { BrandReport } from '@/lib/services/reports'
import type { FeedbackItem } from '@/lib/services/feedback'
import type { FlaggedContentItem } from '@/lib/services/moderation'
import type { PendingBrandEditWithBrand } from '@/lib/types/brand'
import type { ClaimRequest } from '@/lib/services/claim-requests'
import type { Brand } from '@/lib/types'

vi.mock('@/lib/services/submissions', () => ({
  getSubmissionsForReview: vi.fn(),
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

vi.mock('@/lib/services/app-settings', () => ({
  FEATURE_FLAGS: [
    {
      key: 'subcategory_filter_enabled',
      label: 'Subcategory filter on /brands',
      description: 'Shows product-type chips in the directory filter sidebar',
      defaultValue: true,
      revalidatePaths: ['/brands', '/en/brands', '/admin'],
    },
  ],
  getAppSetting: vi.fn(),
}))

vi.mock('next-intl/server', () => {
  const messages: Record<string, string> = {
    'queues.edits.title': 'Brand Edits',
    'queues.edits.empty': 'No pending brand edits.',
    'queues.claims.title': 'Brand Claims',
    'queues.claims.empty': 'No pending brand claims.',
    'queues.reports.title': 'Brand Reports',
    'queues.reports.empty': 'No pending brand reports.',
    'queues.feedback.title': 'User Feedback',
    'queues.feedback.empty': 'No pending user feedback.',
    'stats.totalBrandsLabel': 'Total Brands',
    'stats.totalBrandsDesc': 'Brand records in the database',
    'stats.flaggedContentLabel': 'Pending Content Flags',
    'stats.flaggedContentDesc': 'Flags in the content review queue',
    'stages.needsData': 'Needs Data Work',
    'stages.readyToReview': 'Ready for Review',
    'stages.emptyNeedsData': 'No pending data work.',
    'stages.emptyReadyToReview': 'No brand submissions ready to approve.',
    description: 'Review queues, brand data, and categorization status requiring action.',
    reviewQueues: 'Review Queues',
    reviewQueuesSub: 'Sorted by current pending count.',
    newSubmissions: 'New Brand Submissions',
    newSubmissionsSub: 'Data enrichment must be complete before manual review.',
    overview: 'Overview',
    overviewSub: 'Quick metrics on site data and governance scope.',
    newsletterSection: 'Newsletter Subscribers',
    newsletterSectionSub: 'Email capture list and subscription confirmation status.',
    noDate: 'No date',
    unnamedFeedback: 'Unnamed feedback',
  }
  return {
    getTranslations: vi.fn(() => Promise.resolve((key: string) => messages[key] ?? key)),
  }
})

vi.mock('@/app/admin/actions', () => ({
  approveSubmissionAction: vi.fn(),
  approvePendingEditAction: vi.fn(),
  approveClaimAction: vi.fn(),
  reviewReportAction: vi.fn(),
  reviewFeedbackAction: vi.fn(),
  setFeatureFlagAction: vi.fn(),
}))

function makeSubmission(
  overrides: Partial<BrandSubmissionForReview> = {},
): BrandSubmissionForReview {
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
    websiteUrl: null,
    productTypeNote: null,
    enriched_data: null,
    latestCurationTargetStatus: null,
    latestCurationJobId: null,
    latestCurationPhase: null,
    latestCurationError: null,
    latestCurationJobStatus: null,
    latestCurationDispatchStatus: null,
    reviewStage: 'needs_data',
    reviewData: {
      name: 'Sunrise Studio',
      description: null,
      descriptionEn: null,
      blurb: null,
      blurbEn: null,
      city: null,
      categoryAttributes: null,
      reputationSummary: null,
      retailLocations: null,
      mitEvidence: null,
      siteContent: null,
      foundingYear: null,
      heroImageUrl: null,
      productType: null,
      priceRange: null,
      productTags: [],
      productTagsEn: [],
      websiteUrl: null,
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
      purchaseWebsite: null,
      purchasePinkoi: null,
      purchaseShopee: null,
      otherUrls: [],
    },
    reviewImages: [],
    reviewCompleteness: {
      complete: false,
      missingFields: [
        'description',
        'productType',
        'productTags',
        'priceRange',
        'website',
        'heroImage',
        'additionalImage',
        'successfulEnrichment',
      ],
    },
    ...overrides,
  }
}

function makePendingEdit(
  overrides: Partial<PendingBrandEditWithBrand> = {},
): PendingBrandEditWithBrand {
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
      city: null,
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
      descriptionEn: null,
      blurb: null,
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

function makeFlag(
  overrides: Partial<FlaggedContentItem> = {},
): FlaggedContentItem {
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
    city: null,
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
    productTagsEn: [],
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    imageAlts: [],
    submittedAt: '2026-06-01T00:00:00.000Z',
    approvedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(getAppSetting).mockResolvedValue(true)
  vi.mocked(getSubmissionsForReview).mockResolvedValue([])
  vi.mocked(getPendingEdits).mockResolvedValue([])
  vi.mocked(listClaimRequests).mockResolvedValue([])
  vi.mocked(getPendingReports).mockResolvedValue([])
  vi.mocked(getFeedbackItems).mockResolvedValue([])
  vi.mocked(getFlaggedContent).mockResolvedValue({
    items: [],
    nextCursor: null,
  })
  vi.mocked(getBrands).mockResolvedValue({
    brands: [],
    totalCount: 0,
  })
})

describe('AdminPage', () => {
  it('renders feature toggles with the initial subcategory filter state', async () => {
    vi.mocked(getAppSetting).mockResolvedValueOnce(false)

    render(await AdminDashboardPage())

    expect(screen.getByText('Feature Toggles')).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Subcategory filter on /brands' }),
    ).not.toBeChecked()
    expect(getAppSetting).toHaveBeenCalledWith(
      'subcategory_filter_enabled',
      true,
    )
  })

  it('renders queue summary cards sorted by highest pending count first', async () => {
    vi.mocked(getSubmissionsForReview).mockResolvedValueOnce([
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
    vi.mocked(getFlaggedContent).mockResolvedValueOnce({
      items: [makeFlag()],
      nextCursor: null,
    })

    render(await AdminDashboardPage())

    const cards = screen.getAllByTestId('queue-summary-card')
    expect(within(cards[0]).getByText('Brand Claims')).toBeInTheDocument()
    expect(within(cards[0]).getByText('4')).toBeInTheDocument()
    expect(screen.getByText('Needs Data Work')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(within(cards[1]).getByText('Brand Edits')).toBeInTheDocument()
    expect(within(cards[1]).getByText('2')).toBeInTheDocument()
    expect(
      screen
        .getAllByRole('link', { name: 'View all →' })
        .find((link) => link.getAttribute('href') === '/admin/submissions?stage=needs_data'),
    ).toBeInTheDocument()
  })

  it('renders overview metrics for total brands', async () => {
    vi.mocked(getBrands).mockResolvedValueOnce({
      brands: [makeBrand()],
      totalCount: 42,
    })

    render(await AdminDashboardPage())

    expect(screen.getByText('Total Brands')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('uses the derived submission stage for dashboard queue counts', async () => {
    vi.mocked(getSubmissionsForReview).mockResolvedValueOnce([
      makeSubmission({
        id: 'complete-without-success',
        enriched_data: {
          description: 'Complete data without a successful run',
          heroImageUrl: 'https://example.com/incomplete-run.webp',
          productType: 'crafts',
        },
        reviewStage: 'needs_data',
      }),
      makeSubmission({
        id: 'successful-enrichment',
        enriched_data: {
          description: 'Complete data from a successful run',
          heroImageUrl: 'https://example.com/ready.webp',
          productType: 'crafts',
        },
        latestCurationTargetStatus: 'succeeded',
        reviewStage: 'ready',
      }),
    ])

    render(await AdminDashboardPage())

    const needsDataHeader = screen.getByRole('heading', {
      name: 'Needs Data Work',
    })
    const readyHeader = screen.getByRole('heading', {
      name: 'Ready for Review',
    })
    expect(needsDataHeader.parentElement?.parentElement).toHaveTextContent('1')
    expect(readyHeader.parentElement?.parentElement).toHaveTextContent('1')
  })

  it('shows empty collapsed state for zero-count queues', async () => {
    render(await AdminDashboardPage())

    expect(screen.getByText('No pending data work.')).toBeInTheDocument()
    expect(screen.getByText('No pending brand edits.')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Approve/i }),
    ).not.toBeInTheDocument()
  })
})
