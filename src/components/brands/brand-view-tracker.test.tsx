/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('@/lib/analytics', () => ({
  trackBrandView: vi.fn(),
}))

import { trackBrandView } from '@/lib/analytics'
import { BrandViewTracker } from './brand-view-tracker'

describe('BrandViewTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fires brand_view event on mount with brand slug', () => {
    render(<BrandViewTracker brandSlug="awesome-tea" />)
    expect(trackBrandView).toHaveBeenCalledWith('awesome-tea')
  })

  it('fires only once even on re-render', () => {
    const { rerender } = render(<BrandViewTracker brandSlug="awesome-tea" />)
    rerender(<BrandViewTracker brandSlug="awesome-tea" />)
    expect(trackBrandView).toHaveBeenCalledTimes(1)
  })
})
