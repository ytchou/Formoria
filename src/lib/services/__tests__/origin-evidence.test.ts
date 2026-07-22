import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  stripDeclaration: vi.fn(),
  buildDeclarationRemovedEmail: vi.fn(),
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
  createServiceClient: mocks.createServiceClient,
}))

vi.mock('@/lib/services/mit-declaration', () => ({
  stripDeclaration: mocks.stripDeclaration,
}))

vi.mock('@/lib/email/templates', () => ({
  buildDeclarationRemovedEmail: mocks.buildDeclarationRemovedEmail,
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail: mocks.sendEmail,
}))

import { buildDeclarationRemovedEmail } from '@/lib/email/templates'
import { sendEmail } from '@/lib/email/send'
import { stripDeclaration } from '@/lib/services/mit-declaration'
import { createEvidence, reviewEvidence } from '@/lib/services/origin-evidence'

function pendingCountQuery(count: number) {
  const result = { data: null, error: null, count }
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }
}

describe('origin evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates pending evidence for a signed-in user', async () => {
    const countQuery = pendingCountQuery(0)
    const insertQuery = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'evidence-1' }, error: null }),
    }
    const from = vi.fn()
      .mockReturnValueOnce(countQuery)
      .mockReturnValueOnce(insertQuery)
    mocks.createClient.mockResolvedValue({ from })

    const result = await createEvidence({
      userId: 'user-1',
      brandId: 'brand-1',
      stance: 'contradicts',
      productName: 'Travel Mug',
      sourceType: 'product_label',
      notes: 'The label says Made in China.',
      photoPaths: ['origin-evidence/user-1/brand-1/label.webp'],
    })

    expect(result).toEqual({ ok: true, id: 'evidence-1' })
    expect(insertQuery.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      brand_id: 'brand-1',
      stance: 'contradicts',
      product_name: 'Travel Mug',
      source_type: 'product_label',
      notes: 'The label says Made in China.',
      photo_paths: ['origin-evidence/user-1/brand-1/label.webp'],
      status: 'pending',
    })
  })

  it('caps pending evidence at 3 per user+brand', async () => {
    const countQuery = pendingCountQuery(3)
    const from = vi.fn().mockReturnValue(countQuery)
    mocks.createClient.mockResolvedValue({ from })

    const result = await createEvidence({
      userId: 'user-1',
      brandId: 'brand-1',
      stance: 'supports',
      sourceType: 'official_site',
      notes: 'The official product page states it is made in Taiwan.',
      photoPaths: [],
    })

    expect(result).toEqual({ ok: false, code: 'pending_cap_reached' })
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('reviewEvidence with strip tierAction resets the declaration', async () => {
    const reviewQuery = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'evidence-1',
          brand_id: 'brand-1',
          brands: { name: 'Test Brand' },
        },
        error: null,
      }),
    }
    const ownerQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { user_id: 'owner-1' },
        error: null,
      }),
    }
    const getUserById = vi.fn().mockResolvedValue({
      data: { user: { email: 'owner@example.com' } },
      error: null,
    })
    const from = vi.fn((table: string) => {
      if (table === 'origin_evidence') return reviewQuery
      return ownerQuery
    })
    mocks.createServiceClient.mockReturnValue({
      from,
      auth: { admin: { getUserById } },
    })
    mocks.stripDeclaration.mockResolvedValue({ ok: true })
    mocks.buildDeclarationRemovedEmail.mockResolvedValue({
      to: 'owner@example.com',
      from: 'Formoria <hello@example.com>',
      subject: 'Declaration removed',
      html: '<p>Declaration removed</p>',
    })
    mocks.sendEmail.mockResolvedValue({ success: true, messageId: 'email-1' })

    const result = await reviewEvidence(
      'evidence-1',
      'approved',
      'Community evidence contradicts the declaration.',
      { reviewerId: 'admin-1', tierAction: 'strip_declaration' },
    )

    expect(result).toEqual({ ok: true })
    expect(reviewQuery.update).toHaveBeenCalledWith({
      status: 'approved',
      reviewed_at: expect.any(String),
      reviewed_by: 'admin-1',
      reviewer_notes: 'Community evidence contradicts the declaration.',
    })
    expect(stripDeclaration).toHaveBeenCalledWith(
      'brand-1',
      'admin-1',
      'Community evidence contradicts the declaration.',
    )
    expect(buildDeclarationRemovedEmail).toHaveBeenCalledWith({
      ownerEmail: 'owner@example.com',
      brandName: 'Test Brand',
      reviewerNotes: 'Community evidence contradicts the declaration.',
    })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'owner@example.com',
      subject: 'Declaration removed',
    }))
  })
})
