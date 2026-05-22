/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('@next/third-parties/google', () => ({
  sendGAEvent: vi.fn(),
}))

import { sendGAEvent } from '@next/third-parties/google'
import { BrandViewTracker } from './brand-view-tracker'

describe('BrandViewTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fires brand_view event on mount with brand slug', () => {
    render(<BrandViewTracker brandSlug="awesome-tea" />)
    expect(sendGAEvent).toHaveBeenCalledWith('event', 'brand_detail_viewed', {
      brand_slug: 'awesome-tea',
      source: 'direct',
    })
  })

  it('fires only once even on re-render', () => {
    const { rerender } = render(<BrandViewTracker brandSlug="awesome-tea" />)
    rerender(<BrandViewTracker brandSlug="awesome-tea" />)
    expect(sendGAEvent).toHaveBeenCalledTimes(1)
  })
})
