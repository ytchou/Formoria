// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRedirect = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => { mockRedirect(...args); throw new Error('REDIRECT') },
}))

describe('old route redirect stubs', () => {
  beforeEach(() => { mockRedirect.mockClear() })

  it('/admin/submissions redirects to /admin/review-queue/submissions', async () => {
    const { default: Page } = await import('../submissions/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/review-queue/submissions')
  })

  it('/admin/moderation redirects to /admin/review-queue/moderation', async () => {
    const { default: Page } = await import('../moderation/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/review-queue/moderation')
  })

  it('/admin/pending-edits redirects to /admin/review-queue/edits', async () => {
    const { default: Page } = await import('../pending-edits/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/review-queue/edits')
  })

  it('/admin/claim-requests redirects to /admin/claims', async () => {
    const { default: Page } = await import('../claim-requests/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/claims')
  })

  it('/admin/reports redirects to /admin/signals/reports', async () => {
    const { default: Page } = await import('../reports/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/signals/reports')
  })

  it('/admin/feedback redirects to /admin/signals/feedback', async () => {
    const { default: Page } = await import('../feedback/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/signals/feedback')
  })

  it('/admin/brands redirects to /admin/catalog/brands', async () => {
    const { default: Page } = await import('../brands/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/catalog/brands')
  })

  it('/admin/taxonomy redirects to /admin/catalog/taxonomy', async () => {
    const { default: Page } = await import('../taxonomy/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/catalog/taxonomy')
  })

  it('/admin/bulk-import redirects to /admin/catalog/import', async () => {
    const { default: Page } = await import('../bulk-import/page')
    expect(() => Page()).toThrow('REDIRECT')
    expect(mockRedirect).toHaveBeenCalledWith('/admin/catalog/import')
  })
})
