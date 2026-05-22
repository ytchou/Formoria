// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/services/moderation', () => ({
  getPendingFlags: vi.fn(),
}))

vi.mock('../actions', () => ({
  reviewFlagAction: vi.fn(),
}))

describe('FlaggedPage — diff display', () => {
  it('shows before/after diff when previous_content is present', async () => {
    const { getPendingFlags } = await import('@/lib/services/moderation')
    vi.mocked(getPendingFlags).mockResolvedValue([
      {
        id: 'flag-1',
        brandId: 'brand-1',
        brandName: 'Test Brand',
        brandSlug: 'test-brand',
        userId: 'user-1',
        fieldName: 'description',
        flaggedContent: 'SPAMMY NEW CONTENT',
        previousContent: 'Original clean description',
        flagReason: 'SEO spam detected',
        tier: 'flag',
        status: 'pending',
        reviewedAt: null,
        createdAt: '2026-05-22T00:00:00Z',
      },
    ])

    const FlaggedPage = (await import('./page')).default
    render(await FlaggedPage())

    expect(screen.getByText('Original clean description')).toBeInTheDocument()
    expect(screen.getByText('SPAMMY NEW CONTENT')).toBeInTheDocument()
    expect(screen.getByText(/before/i)).toBeInTheDocument()
    expect(screen.getByText(/after/i)).toBeInTheDocument()
  })

  it('shows only current content when previous_content is null', async () => {
    const { getPendingFlags } = await import('@/lib/services/moderation')
    vi.mocked(getPendingFlags).mockResolvedValue([
      {
        id: 'flag-2',
        brandId: 'brand-2',
        brandName: 'Test Brand',
        brandSlug: 'test-brand',
        userId: 'user-1',
        fieldName: 'description',
        flaggedContent: 'Some content',
        previousContent: null,
        flagReason: 'test',
        tier: 'flag',
        status: 'pending',
        reviewedAt: null,
        createdAt: '2026-05-22T00:00:00Z',
      },
    ])

    const FlaggedPage = (await import('./page')).default
    render(await FlaggedPage())

    expect(screen.queryByText(/before/i)).not.toBeInTheDocument()
    expect(screen.getByText('Some content')).toBeInTheDocument()
  })
})
