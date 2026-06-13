import { beforeEach, describe, it, expect, vi } from 'vitest'

const mockInsert = vi.fn()
const mockSelect = vi.fn()
const mockOrder = vi.fn()
const mockSingle = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: mockFrom }),
  createServiceClient: () => ({ from: mockFrom }),
}))

beforeEach(() => {
  vi.clearAllMocks()

  mockOrder.mockResolvedValue({ data: [], error: null })
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
      submitted_at: '2026-06-13T00:00:00.000Z',
      reviewed_at: null,
      reviewed_by: null,
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

  mockSelect.mockReturnValue({ order: mockOrder, single: mockSingle })
  mockInsert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) })
  mockFrom.mockReturnValue({
    insert: mockInsert,
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

  it('stores null logo_url when logoUrl is undefined', async () => {
    const { buildSubmissionRecord } = await import('../submissions')
    const record = buildSubmissionRecord({ ...base, logoUrl: undefined })
    expect(record.logo_url).toBeNull()
  })

  it('stores valid logo_url when provided', async () => {
    const { buildSubmissionRecord } = await import('../submissions')
    const record = buildSubmissionRecord({
      ...base,
      logoUrl: 'https://cdn.example.com/logo.png',
    })
    expect(record.logo_url).toBe('https://cdn.example.com/logo.png')
  })

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
