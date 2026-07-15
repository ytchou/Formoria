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
    window.history.replaceState({}, '', '/')
  })

  it('fires view_item event on mount with item id', () => {
    render(<BrandViewTracker brandSlug="awesome-tea" />)
    expect(sendGAEvent).toHaveBeenCalledWith('event', 'view_item', {
      item_id: 'awesome-tea',
      source: 'direct',
    })
  })

  it('fires only once even on re-render', () => {
    const { rerender } = render(<BrandViewTracker brandSlug="awesome-tea" />)
    rerender(<BrandViewTracker brandSlug="awesome-tea" />)
    expect(sendGAEvent).toHaveBeenCalledTimes(1)
  })

  it('reads the in-app source from the URL without making the page dynamic', () => {
    window.history.replaceState({}, '', '/brands/awesome-tea?source=category')
    render(<BrandViewTracker brandSlug="awesome-tea" />)

    expect(sendGAEvent).toHaveBeenCalledWith('event', 'view_item', {
      item_id: 'awesome-tea',
      source: 'category',
    })
  })
})
