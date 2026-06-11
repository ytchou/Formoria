import { describe, it, expect, vi, beforeEach } from 'vitest'

const createClaimRequest = vi.hoisted(() => vi.fn())

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(
    new Map([['x-forwarded-for', '127.0.0.1']])
  ),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockImplementation(async () => (key: string) => key),
}))

vi.mock('@/lib/services/reports', () => ({
  createReport: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/claim-requests', () => ({
  createClaimRequest: (...a: unknown[]) => createClaimRequest(...a),
  CLAIM_PROOF_TYPES: ['domain_email', 'social_dm', 'backend_screenshot', 'business_doc'],
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
    createClaimRequest.mockResolvedValue({ id: 'c1' })
  })

  it('rejects when fewer than 2 proofs are provided', async () => {
    const res = await submitClaimAction({
      brandId: 'b1',
      proofs: [{ type: 'domain_email', url: 'mailto:a@b.com' }],
    })

    expect(res).toMatchObject({ error: expect.any(String) })
    expect(createClaimRequest).not.toHaveBeenCalled()
  })

  it('rejects an imageKey outside the user namespace', async () => {
    const res = await submitClaimAction({
      brandId: 'b1',
      proofs: [
        { type: 'domain_email', url: 'mailto:a@b.com' },
        { type: 'backend_screenshot', imageKey: 'claim-proofs/OTHER/b1/x.webp' },
      ],
    })

    expect(res).toMatchObject({ error: expect.any(String) })
    expect(createClaimRequest).not.toHaveBeenCalled()
  })

  it('forwards 2 valid proofs to the service', async () => {
    const res = await submitClaimAction({
      brandId: 'b1',
      proofs: [
        { type: 'domain_email', url: 'mailto:a@b.com' },
        { type: 'backend_screenshot', imageKey: 'claim-proofs/u1/b1/x.webp' },
      ],
      mitSmileCert: '01200024-02134',
    })

    expect(res).toEqual({ ok: true })
    expect(createClaimRequest).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'b1', userId: 'u1' })
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
    vi.mocked(headers).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Map([['x-forwarded-for', '10.9.9.9']]) as any
    )
    const fd = makeFormData({ brandId: 'b1', reason: 'not_mit' })
    await submitReportAction({}, fd)
    await submitReportAction({}, fd)
    await submitReportAction({}, fd)
    const result = await submitReportAction({}, fd)
    expect(result.error).toBeTruthy()
    expect(result.success).toBeUndefined()
  })
})
