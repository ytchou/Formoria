import { describe, it, expect, vi, beforeEach } from 'vitest'

const createClaimRequest = vi.hoisted(() => vi.fn())
const createReport = vi.hoisted(() => vi.fn())

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(
    new Map([['cf-connecting-ip', '127.0.0.1'], ['x-forwarded-for', '127.0.0.1']])
  ),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockImplementation(async () => (key: string) => key),
}))

vi.mock('@/lib/services/reports', () => ({
  createReport: (...a: unknown[]) => createReport(...a),
}))

vi.mock('@/lib/services/claim-requests', () => ({
  createClaimRequest: (...a: unknown[]) => createClaimRequest(...a),
  CLAIM_PROOF_TYPES: ['domain_email', 'backend_screenshot', 'business_doc'],
}))

vi.mock('@/lib/services/brands', () => ({
  getBrandById: vi.fn(async () => ({
    name: 'Brand',
    socialLinks: { officialWebsite: 'https://brand.example' },
  })),
}))

vi.mock('@/lib/auth/claim-user', () => ({
  requireClaimUser: vi.fn(async () => ({ id: 'u1' })),
}))

function makeFormData(data: Record<string, string>) {
  const fd = new FormData()
  Object.entries(data).forEach(([k, v]) => fd.set(k, v))
  return fd
}

// Reimport to get fresh module (rate limiter state resets per test file)
const { submitClaimAction, submitReportAction } = await import('../actions')

describe('submitClaimAction', () => {
  beforeEach(() => {
    createClaimRequest.mockReset()
    createClaimRequest.mockResolvedValue({ id: 'c1', emailVerificationTokens: [] })
  })

  it('rejects when no proofs are provided', async () => {
    const res = await submitClaimAction({
      brandId: 'b1',
      proofs: [],
    })

    expect(res).toMatchObject({ error: expect.any(String) })
    expect(createClaimRequest).not.toHaveBeenCalled()
  })

  it('rejects an imageKey outside the user namespace', async () => {
    const res = await submitClaimAction({
      brandId: 'b1',
      proofs: [{ type: 'backend_screenshot', imageKey: 'claim-proofs/OTHER/b1/x.webp' }],
    })

    expect(res).toMatchObject({ error: expect.any(String) })
    expect(createClaimRequest).not.toHaveBeenCalled()
  })

  it('rejects domain email proof without a valid email', async () => {
    const res = await submitClaimAction({
      brandId: 'b1',
      proofs: [{ type: 'domain_email', url: 'https://brand.example/proof' }],
    })

    expect(res).toMatchObject({ error: expect.any(String) })
    expect(createClaimRequest).not.toHaveBeenCalled()
  })

  it('rejects upload-backed proof without an image key', async () => {
    const res = await submitClaimAction({
      brandId: 'b1',
      proofs: [{ type: 'business_doc' }],
    })

    expect(res).toMatchObject({ error: expect.any(String) })
    expect(createClaimRequest).not.toHaveBeenCalled()
  })

  it('forwards 1 valid proof to the service', async () => {
    const res = await submitClaimAction({
      brandId: 'b1',
      proofs: [{ type: 'backend_screenshot', imageKey: 'claim-proofs/u1/b1/x.webp' }],
      mitSmileCert: '01200024-02134',
    })

    expect(res).toEqual({ ok: true })
    expect(createClaimRequest).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'b1', userId: 'u1' })
    )
  })

  it('forwards a valid domain email proof to the service', async () => {
    const res = await submitClaimAction({
      brandId: 'b1',
      proofs: [{ type: 'domain_email', url: 'owner@brand.example' }],
    })

    expect(res).toEqual({ ok: true })
    expect(createClaimRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        proofEvidence: [{ type: 'domain_email', url: 'owner@brand.example' }],
      })
    )
  })
})

describe('submitReportAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when brandId is missing', async () => {
    const result = await submitReportAction({}, makeFormData({ reason: 'not_mit' }))
    expect(result.error).toBeTruthy()
    expect(result.success).toBeUndefined()
  })

  it('returns error when reason is invalid', async () => {
    const result = await submitReportAction({}, makeFormData({ brandId: 'b1', reason: 'made_up' }))
    expect(result.error).toBeTruthy()
  })

  it('rejects multiple otherwise-valid report reasons', async () => {
    const result = await submitReportAction({}, makeFormData({
      brandId: 'b1',
      reason: 'broken_link,inappropriate',
    }))
    expect(result.error).toBeTruthy()
    expect(createReport).not.toHaveBeenCalled()
  })

  it('returns error when notes exceed 1000 chars', async () => {
    const result = await submitReportAction({}, makeFormData({
      brandId: 'b1',
      reason: 'not_mit',
      notes: 'x'.repeat(1001),
    }))
    expect(result.error).toBeTruthy()
  })

  it('returns success for valid minimal input', async () => {
    const result = await submitReportAction({}, makeFormData({
      brandId: 'b1',
      reason: 'not_mit',
    }))
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('returns success when notes are within limit', async () => {
    const result = await submitReportAction({}, makeFormData({
      brandId: 'b1',
      reason: 'broken_link',
      notes: 'x'.repeat(1000),
    }))
    expect(result.success).toBe(true)
  })

  it('returns throttle error on 4th report from same IP', async () => {
    // Use a unique IP to avoid interference from other tests above (127.0.0.1 used 1 call)
    const { headers } = await import('next/headers')
    vi.mocked(headers).mockResolvedValue(new Map([
      ['cf-connecting-ip', '10.9.9.9'],
      ['x-forwarded-for', '10.9.9.9'],
    ]) as unknown as Awaited<ReturnType<typeof headers>>)
    const fd = makeFormData({ brandId: 'b1', reason: 'not_mit' })
    await submitReportAction({}, fd)
    await submitReportAction({}, fd)
    await submitReportAction({}, fd)
    const result = await submitReportAction({}, fd)
    expect(result.error).toBeTruthy()
    expect(result.success).toBeUndefined()
  })
})

describe('submitReportAction — authenticated report reasons', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    createReport.mockResolvedValue(undefined)

    const { headers } = await import('next/headers')
    vi.mocked(headers).mockResolvedValue(
      new Map([['cf-connecting-ip', '198.51.100.9']]) as unknown as Awaited<ReturnType<typeof headers>>
    )
  })

  it('rejects ownership_dispute from unauthenticated users', async () => {
    const { requireClaimUser } = await import('@/lib/auth/claim-user')
    vi.mocked(requireClaimUser).mockResolvedValueOnce(null)

    const result = await submitReportAction({}, makeFormData({
      brandId: 'b1',
      reason: 'ownership_dispute',
    }))

    expect(result.error).toBeTruthy()
    expect(requireClaimUser).toHaveBeenCalledOnce()
    expect(createReport).not.toHaveBeenCalled()
  })

  it('rejects ownership_dispute combined with other reasons', async () => {
    const result = await submitReportAction({}, makeFormData({
      brandId: 'b1',
      reason: 'ownership_dispute,broken_link',
    }))

    expect(result.error).toBeTruthy()
    expect(createReport).not.toHaveBeenCalled()
  })

  it('passes userId through for authenticated sole-reason disputes', async () => {
    const { requireClaimUser } = await import('@/lib/auth/claim-user')
    vi.mocked(requireClaimUser).mockResolvedValueOnce({ id: 'user-uuid-9' })

    const result = await submitReportAction({}, makeFormData({
      brandId: 'b1',
      reason: 'ownership_dispute',
    }))

    expect(result.success).toBe(true)
    expect(createReport).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-uuid-9',
    }))
  })

  it('rejects removal_request from unauthenticated users', async () => {
    const { requireClaimUser } = await import('@/lib/auth/claim-user')
    vi.mocked(requireClaimUser).mockResolvedValueOnce(null)

    const result = await submitReportAction({}, makeFormData({
      brandId: 'b1',
      reason: 'removal_request',
    }))

    expect(result.error).toBeTruthy()
    expect(requireClaimUser).toHaveBeenCalledOnce()
    expect(createReport).not.toHaveBeenCalled()
  })

  it('passes userId through for authenticated removal requests', async () => {
    const { requireClaimUser } = await import('@/lib/auth/claim-user')
    vi.mocked(requireClaimUser).mockResolvedValueOnce({ id: 'user-uuid-10' })

    const result = await submitReportAction({}, makeFormData({
      brandId: 'b1',
      reason: 'removal_request',
    }))

    expect(result.success).toBe(true)
    expect(createReport).toHaveBeenCalledWith({
      brandId: 'b1',
      reason: 'removal_request',
      notes: null,
      userId: 'user-uuid-10',
    })
  })

  it('keeps other reasons anonymous (no auth requirement)', async () => {
    const { requireClaimUser } = await import('@/lib/auth/claim-user')

    const result = await submitReportAction({}, makeFormData({
      brandId: 'b1',
      reason: 'broken_link',
    }))

    expect(result.success).toBe(true)
    expect(requireClaimUser).not.toHaveBeenCalled()
    expect(createReport).toHaveBeenCalledWith({
      brandId: 'b1',
      reason: 'broken_link',
      notes: null,
    })
  })
})
