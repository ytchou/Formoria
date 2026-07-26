/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

import { BrandViewTracker } from './brand-view-tracker'

const sendGAEvent = vi.fn()

describe('BrandViewTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.gtag = sendGAEvent
    window.history.replaceState({}, '', '/')
  })


  it('fires only once even on re-render', () => {
    const { rerender } = render(<BrandViewTracker brandSlug="awesome-tea" />)
    rerender(<BrandViewTracker brandSlug="awesome-tea" />)
    expect(sendGAEvent).toHaveBeenCalledTimes(1)
  })

})
