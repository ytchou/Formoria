import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(
    new Map([['x-forwarded-for', '127.0.0.1']])
  ),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/services/reports', () => ({
  createReport: vi.fn().mockResolvedValue(undefined),
}))

function makeFormData(data: Record<string, string>) {
  const fd = new FormData()
  Object.entries(data).forEach(([k, v]) => fd.set(k, v))
  return fd
}

// Reimport to get fresh module (rate limiter state resets per test file)
const { submitReportAction } = await import('../actions')

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
