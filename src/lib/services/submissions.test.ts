import { describe, it, test, expect, vi, beforeEach } from 'vitest'
import { submissionToDomain, submissionToInsert, getSubmission, checkBrandDuplicates } from './submissions'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'

describe('submissionToDomain', () => {
  it('transforms snake_case DB row to camelCase BrandSubmission', () => {
    const dbRow = {
      id: 'sub-1',
      brand_id: null,
      brand_name: 'Cool Brand',
      submitter_email: 'submitter@example.com',
      submitter_name: 'John Doe',
      description: 'A cool brand from Taiwan',
      website_url: 'https://coolbrand.tw',
      social_instagram: '@coolbrand',
      suggested_tags: ['artisan', 'organic'],
      status: 'pending',
      reviewer_notes: null,
      submitted_at: '2026-01-01T00:00:00Z',
      reviewed_at: null,
      reviewed_by: null,
      validation_status: null,
      validation_errors: null,
      notified_at: null,
      is_brand_owner: false,
    }

    const submission = submissionToDomain(dbRow)

    expect(submission.id).toBe('sub-1')
    expect(submission.brandId).toBeNull()
    expect(submission.brandName).toBe('Cool Brand')
    expect(submission.submitterEmail).toBe('submitter@example.com')
    expect(submission.submitterName).toBe('John Doe')
    expect(submission.websiteUrl).toBe('https://coolbrand.tw')
    expect(submission.socialInstagram).toBe('@coolbrand')
    expect(submission.suggestedTags).toEqual(['artisan', 'organic'])
    expect(submission.status).toBe('pending')
    expect(submission.reviewerNotes).toBeNull()
    expect(submission.reviewedAt).toBeNull()
    expect(submission.reviewedBy).toBeNull()
    expect(submission.validationStatus).toBeNull()
    expect(submission.validationErrors).toBeNull()
    expect(submission.notifiedAt).toBeNull()
    expect(submission.isBrandOwner).toBe(false)
  })

  it('maps pipeline fields from database row', () => {
    const dbRow = {
      id: 'sub-2',
      brand_id: null,
      brand_name: 'Pipeline Brand',
      submitter_email: 'test@test.com',
      submitter_name: null,
      description: 'A test brand description that is long enough',
      website_url: 'https://test.com',
      social_instagram: null,
      suggested_tags: [],
      status: 'pending',
      reviewer_notes: null,
      submitted_at: '2026-05-18T00:00:00Z',
      reviewed_at: null,
      reviewed_by: null,
      validation_status: 'valid',
      validation_errors: null,
      notified_at: '2026-05-18T09:00:00Z',
      is_brand_owner: true,
    }

    const submission = submissionToDomain(dbRow)

    expect(submission.validationStatus).toBe('valid')
    expect(submission.validationErrors).toBeNull()
    expect(submission.notifiedAt).toBe('2026-05-18T09:00:00Z')
    expect(submission.isBrandOwner).toBe(true)
  })
})

describe('getSubmission', () => {
  it('should be an exported async function', () => {
    expect(typeof getSubmission).toBe('function')
  })
})

describe('submissionToInsert', () => {
  it('transforms camelCase domain data to snake_case DB row', () => {
    const input = {
      brandName: 'New Brand',
      submitterEmail: 'new@example.com',
      submitterName: 'Jane Doe',
      description: 'Brand description',
      websiteUrl: 'https://newbrand.tw',
      socialInstagram: '@new',
      suggestedTags: ['eco-friendly'],
    }

    const row = submissionToInsert(input)

    expect(row.brand_name).toBe('New Brand')
    expect(row.submitter_email).toBe('new@example.com')
    expect(row.submitter_name).toBe('Jane Doe')
    expect(row.website_url).toBe('https://newbrand.tw')
    expect(row.social_instagram).toBe('@new')
    expect(row.suggested_tags).toEqual(['eco-friendly'])
    expect(row).not.toHaveProperty('brandName')
    expect(row).not.toHaveProperty('submitterEmail')
  })
})

describe('checkBrandDuplicates', () => {
  const mockRpc = vi.fn()

  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue(
      { rpc: mockRpc } as unknown as Awaited<ReturnType<typeof createClient>>
    )
    mockRpc.mockReset()
  })

  test('returns ubn_match when exact UBN found', async () => {
    mockRpc.mockResolvedValue({
      data: {
        ubn_match: { id: 'brand-1', name: '品牌 A', slug: 'brand-a' },
        name_matches: [],
      },
      error: null,
    })

    const result = await checkBrandDuplicates('品牌 A', '12345678')
    expect(result.ubnMatch).toEqual({ id: 'brand-1', name: '品牌 A', slug: 'brand-a' })
    expect(result.nameMatches).toEqual([])
    expect(mockRpc).toHaveBeenCalledWith('check_brand_duplicates', {
      p_name: '品牌 A',
      p_ubn: '12345678',
    })
  })

  test('returns name_matches when similar brands found', async () => {
    const candidate = { id: 'brand-2', name: '品牌B', slug: 'brand-b', similarity: 0.85 }
    mockRpc.mockResolvedValue({
      data: { ubn_match: null, name_matches: [candidate] },
      error: null,
    })

    const result = await checkBrandDuplicates('品牌 B')
    expect(result.ubnMatch).toBeNull()
    expect(result.nameMatches).toHaveLength(1)
    expect(result.nameMatches[0].similarity).toBe(0.85)
  })

  test('passes null for ubn when not provided', async () => {
    mockRpc.mockResolvedValue({
      data: { ubn_match: null, name_matches: [] },
      error: null,
    })

    await checkBrandDuplicates('Some Brand')
    expect(mockRpc).toHaveBeenCalledWith('check_brand_duplicates', {
      p_name: 'Some Brand',
      p_ubn: null,
    })
  })

  test('returns empty result on RPC error (fail open)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } })

    const result = await checkBrandDuplicates('品牌 C', '99999999')
    expect(result.ubnMatch).toBeNull()
    expect(result.nameMatches).toEqual([])
  })
})
