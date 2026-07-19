import { beforeEach, describe, it, expect, vi } from 'vitest'

const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockSelect = vi.fn()
const mockOrder = vi.fn()
const mockSingle = vi.fn()
const mockFrom = vi.fn()
const mockRpc = vi.fn()
const mockDeleteStoredImagePaths = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: mockFrom }),
  createServiceClient: () => ({ from: mockFrom, rpc: mockRpc }),
}))

vi.mock('@/lib/services/image-upload', () => ({
  deleteStoredImagePaths: mockDeleteStoredImagePaths,
}))

beforeEach(() => {
  vi.clearAllMocks()

  mockOrder.mockResolvedValue({ data: [], error: null })
  mockRpc.mockResolvedValue({ data: [], error: null })
  mockDeleteStoredImagePaths.mockResolvedValue(undefined)
  mockSingle.mockResolvedValue({
    data: {
      id: 'submission-1',
      brand_id: 'brand-123',
      brand_name: 'Test Brand',
      submitter_email: 'test@example.com',
      submitter_name: 'Test User',
      description: 'Test description',
      website_url: 'https://testbrand.com',
      social_links: {},
      suggested_tags: [],
      status: 'pending',
      reviewer_notes: null,
      denial_reason: null,
      submitted_at: '2026-06-13T00:00:00.000Z',
      reviewed_at: null,
      reviewed_by: null,
      pdpa_consent_at: '2026-06-13T00:00:00.000Z',
      validation_status: null,
      validation_errors: null,
      notified_at: null,
      intent: 'recommend',
      is_brand_owner: false,
      source_attribution: null,
      product_type_note: null,
    },
    error: null,
  })

  mockSelect.mockReturnValue({ order: mockOrder, single: mockSingle, eq: mockEq })
  mockInsert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) })
  mockEq.mockReturnValue({ eq: mockEq, select: mockSelect, single: mockSingle })
  mockUpdate.mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
  })
})

const validSubmissionData = {
  brandId: 'brand-123',
  brandName: 'Test Brand',
  submitterEmail: 'test@example.com',
  submitterName: 'Test User',
  description: 'Test description',
  websiteUrl: 'https://testbrand.com',
  socialLinks: {},
  suggestedTags: [],
  pdpaConsentAt: new Date().toISOString(),
  isBrandOwner: false,
}

// Test the pure record-building logic without DB calls
describe('buildSubmissionRecord', () => {
  const base = {
    brandId: 'brand-123',
    brandName: 'Test Brand',
    submitterEmail: 'test@example.com',
    submitterName: 'Test User',
    description: 'Test description',
    websiteUrl: 'https://testbrand.com',
    socialLinks: {},
    suggestedTags: [],
    pdpaConsentAt: new Date().toISOString(),
    isOwner: false,
  }

  it('stores source_attribution when provided', async () => {
    const { buildSubmissionRecord } = await import('../submissions')
    const record = buildSubmissionRecord({
      ...base,
      sourceAttribution: 'found_online',
    })
    expect(record.source_attribution).toBe('found_online')
  })

  it('stores null source_attribution when not provided', async () => {
    const { buildSubmissionRecord } = await import('../submissions')
    const record = buildSubmissionRecord(base)
    expect(record.source_attribution).toBeNull()
  })

  it('stores is_brand_owner boolean', async () => {
    const { buildSubmissionRecord } = await import('../submissions')
    const ownerRecord = buildSubmissionRecord({ ...base, isOwner: true })
    expect(ownerRecord.is_brand_owner).toBe(true)

    const communityRecord = buildSubmissionRecord({ ...base, isOwner: false })
    expect(communityRecord.is_brand_owner).toBe(false)
  })

  it('stores submission intent when provided', async () => {
    const { buildSubmissionRecord } = await import('../submissions')
    const record = buildSubmissionRecord({ ...base, intent: 'owner_claim' })
    expect(record.intent).toBe('owner_claim')
  })
})

describe('submissionToDomain (flat link columns)', () => {
  it('maps flat social and purchase columns from DB row', async () => {
    const { submissionToDomain } = await import('../submissions')

    const submission = submissionToDomain({
      id: 'submission-1',
      brand_id: 'brand-123',
      brand_name: 'Test Brand',
      submitter_email: 'test@example.com',
      submitter_name: 'Test User',
      description: 'Test description',
      website_url: 'https://legacy.example.com',
      social_instagram: 'brand_ig',
      social_threads: '@brand_threads',
      social_facebook: 'https://fb.com/brand',
      purchase_website: 'https://brand.com',
      purchase_pinkoi: null,
      purchase_shopee: null,
      other_urls: [],
      suggested_tags: [],
      status: 'pending',
      reviewer_notes: null,
      submitted_at: '2026-06-13T00:00:00.000Z',
      reviewed_at: null,
      reviewed_by: null,
      pdpa_consent_at: '2026-06-13T00:00:00.000Z',
      validation_status: null,
      validation_errors: null,
      notified_at: null,
      intent: 'recommend',
      is_brand_owner: false,
      source_attribution: null,
      product_type_note: null,
    })

    expect(submission.socialInstagram).toBe('brand_ig')
    expect(submission.socialThreads).toBe('@brand_threads')
    expect(submission.socialFacebook).toBe('https://fb.com/brand')
    expect(submission.purchaseWebsite).toBe('https://brand.com')
    expect(submission.purchasePinkoi).toBeNull()
    expect(submission.purchaseShopee).toBeNull()
    expect(submission.otherUrls).toEqual([])
  })
})

describe('submissionToInsert (flat link columns)', () => {
  it('serializes flat link fields to snake_case columns', async () => {
    const { submissionToInsert } = await import('../submissions')

    const row = submissionToInsert({
      brandName: 'Test Brand',
      submitterEmail: 'test@example.com',
      socialInstagram: 'brand_ig',
      socialFacebook: null,
      purchaseWebsite: 'https://brand.com',
      purchasePinkoi: 'https://pinkoi.com/store/brand',
      otherUrls: [],
    })

    expect(row.social_instagram).toBe('brand_ig')
    expect(row.social_facebook).toBeNull()
    expect(row.purchase_website).toBe('https://brand.com')
    expect(row.purchase_pinkoi).toBe('https://pinkoi.com/store/brand')
    expect(row.other_urls).toEqual([])
  })
})

describe('createSubmission — product_type_note', () => {
  it('persists product_type_note when provided', async () => {
    const { createSubmission } = await import('../submissions')

    await createSubmission({
      ...validSubmissionData,
      productTypeNote: '手工皮件',
    })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ product_type_note: '手工皮件' })
    )
  })

  it('persists null product_type_note when not provided', async () => {
    const { createSubmission } = await import('../submissions')

    await createSubmission({ ...validSubmissionData })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ product_type_note: null })
    )
  })
})

describe('getApprovedOwnerSubmissionRecipients', () => {
  it('returns the latest approved owner-submission recipient for each requested brand', async () => {
    const mockIn = vi.fn()
    const ownerQuery = {
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            brand_id: 'brand-1',
            submitter_email: 'latest@example.com',
            submitted_at: '2026-07-19T10:00:00Z',
          },
          {
            brand_id: 'brand-1',
            submitter_email: 'older@example.com',
            submitted_at: '2026-07-18T10:00:00Z',
          },
          {
            brand_id: 'brand-2',
            submitter_email: 'second@example.com',
            submitted_at: '2026-07-17T10:00:00Z',
          },
        ],
        error: null,
      }),
    }
    ownerQuery.eq.mockReturnValue(ownerQuery)
    mockIn.mockReturnValue(ownerQuery)
    mockSelect.mockReturnValueOnce({ in: mockIn })
    const { getApprovedOwnerSubmissionRecipients } = await import('../submissions')

    const recipients = await getApprovedOwnerSubmissionRecipients(['brand-1', 'brand-2'])

    expect(mockIn).toHaveBeenCalledWith('brand_id', ['brand-1', 'brand-2'])
    expect(ownerQuery.eq).toHaveBeenNthCalledWith(1, 'status', 'approved')
    expect(ownerQuery.eq).toHaveBeenNthCalledWith(2, 'is_brand_owner', true)
    expect(recipients).toEqual(
      new Map([
        ['brand-1', { submitterEmail: 'latest@example.com' }],
        ['brand-2', { submitterEmail: 'second@example.com' }],
      ])
    )
  })

  it('does not query Supabase when no brand IDs are requested', async () => {
    const { getApprovedOwnerSubmissionRecipients } = await import('../submissions')

    await expect(getApprovedOwnerSubmissionRecipients([])).resolves.toEqual(new Map())
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('rejectSubmission', () => {
  const TEST_REVIEWER_ID = 'reviewer-123'

  it('persists denial_reason alongside status and reviewer_notes', async () => {
    mockRpc.mockResolvedValueOnce({
      data: ['submissions/submission-1/image.webp'],
      error: null,
    })
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'submission-1',
        brand_id: 'brand-123',
        brand_name: 'Test Brand',
        submitter_email: 'test@example.com',
        submitter_name: 'Test User',
        description: 'Test description',
        website_url: 'https://testbrand.com',
        social_links: {},
        suggested_tags: [],
        status: 'rejected',
        reviewer_notes: 'Brand manufactures in China, not Taiwan',
        denial_reason: 'not_mit',
        submitted_at: '2026-06-13T00:00:00.000Z',
        reviewed_at: '2026-06-14T00:00:00.000Z',
        reviewed_by: TEST_REVIEWER_ID,
        pdpa_consent_at: '2026-06-13T00:00:00.000Z',
        validation_status: null,
        validation_errors: null,
        notified_at: null,
        is_brand_owner: false,
        source_attribution: null,
        product_type_note: null,
      },
      error: null,
    })
    const { rejectSubmission } = await import('../submissions')

    const result = await rejectSubmission(
      'submission-1',
      TEST_REVIEWER_ID,
      'not_mit',
      'Brand manufactures in China, not Taiwan'
    )

    expect(mockRpc).toHaveBeenCalledWith('reject_submission', {
      p_denial_reason: 'not_mit',
      p_reviewer_id: TEST_REVIEWER_ID,
      p_reviewer_notes: 'Brand manufactures in China, not Taiwan',
      p_submission_id: 'submission-1',
    })
    expect(mockDeleteStoredImagePaths).toHaveBeenCalledWith([
      'submissions/submission-1/image.webp',
    ])
    expect(result.status).toBe('rejected')
    expect(result.denialReason).toBe('not_mit')
    expect(result.reviewerNotes).toBe('Brand manufactures in China, not Taiwan')
  })

  it('allows rejection without notes', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'submission-1',
        brand_id: 'brand-123',
        brand_name: 'Test Brand',
        submitter_email: 'test@example.com',
        submitter_name: 'Test User',
        description: 'Test description',
        website_url: 'https://testbrand.com',
        social_links: {},
        suggested_tags: [],
        status: 'rejected',
        reviewer_notes: null,
        denial_reason: 'duplicate',
        submitted_at: '2026-06-13T00:00:00.000Z',
        reviewed_at: '2026-06-14T00:00:00.000Z',
        reviewed_by: TEST_REVIEWER_ID,
        pdpa_consent_at: '2026-06-13T00:00:00.000Z',
        validation_status: null,
        validation_errors: null,
        notified_at: null,
        is_brand_owner: false,
        source_attribution: null,
        product_type_note: null,
      },
      error: null,
    })
    const { rejectSubmission } = await import('../submissions')

    const result = await rejectSubmission('submission-1', TEST_REVIEWER_ID, 'duplicate')

    expect(mockRpc).toHaveBeenCalledWith('reject_submission', {
      p_denial_reason: 'duplicate',
      p_reviewer_id: TEST_REVIEWER_ID,
      p_reviewer_notes: null,
      p_submission_id: 'submission-1',
    })
    expect(result.status).toBe('rejected')
    expect(result.denialReason).toBe('duplicate')
    expect(result.reviewerNotes).toBeNull()
  })
})

describe('getAdminSubmissions — includes product_type_note', () => {
  it('returns product_type_note in each submission', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        {
          id: 'submission-1',
          brand_id: 'brand-123',
          brand_name: 'Test Brand',
          submitter_email: 'test@example.com',
          submitter_name: 'Test User',
          description: 'Test description',
          website_url: 'https://testbrand.com',
          social_links: {},
          suggested_tags: [],
          status: 'pending',
          reviewer_notes: null,
          submitted_at: '2026-06-13T00:00:00.000Z',
          reviewed_at: null,
          reviewed_by: null,
          pdpa_consent_at: '2026-06-13T00:00:00.000Z',
          validation_status: null,
          validation_errors: null,
          notified_at: null,
          is_brand_owner: false,
          source_attribution: null,
          product_type_note: '手工皮件',
        },
      ],
      error: null,
    })
    const { getAdminSubmissions } = await import('../submissions')

    const result = await getAdminSubmissions()

    expect(result[0]).toHaveProperty('productTypeNote', '手工皮件')
  })
})
