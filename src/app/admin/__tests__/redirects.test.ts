// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRedirect = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => { mockRedirect(...args); throw new Error('REDIRECT') },
}))

describe('old route redirect stubs', () => {
  beforeEach(() => { mockRedirect.mockClear() })

  it('/admin/review-queue/submissions redirects to /admin/submissions', async () => {
    const { default: Page } = await import('../review-queue/submissions/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/submissions')
  })

  it('/admin/review-queue/moderation redirects to /admin/moderation', async () => {
    const { default: Page } = await import('../review-queue/moderation/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/moderation')
  })

  it('/admin/review-queue/edits redirects to /admin/edits', async () => {
    const { default: Page } = await import('../review-queue/edits/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/edits')
  })

  it('/admin/pending-edits redirects to /admin/edits', async () => {
    const { default: Page } = await import('../pending-edits/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/edits')
  })

  it('/admin/claim-requests redirects to /admin/claims', async () => {
    const { default: Page } = await import('../claim-requests/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/claims')
  })

  it('/admin/signals/reports redirects to /admin/reports', async () => {
    const { default: Page } = await import('../signals/reports/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/reports')
  })

  it('/admin/catalog/brands redirects to /admin/brands', async () => {
    const { default: Page } = await import('../catalog/brands/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/brands')
  })

})
