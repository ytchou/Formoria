/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSkipNextPageview } = vi.hoisted(() => ({ mockSkipNextPageview: vi.fn() }))

vi.mock('@/lib/analytics/pageview-skip', () => ({
  skipNextPageview: mockSkipNextPageview,
}))

import { DiscoverUrlSync } from '../discover-url-sync'

describe('DiscoverUrlSync', () => {
  let replaceSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    window.history.pushState({}, '', '/en/discover?q=tea')
    mockSkipNextPageview.mockClear()
    replaceSpy = vi.spyOn(window.history, 'replaceState')
  })

  afterEach(() => {
    replaceSpy.mockRestore()
  })

  it('replaces the URL with pathname + target, keeping the locale prefix', () => {
    render(<DiscoverUrlSync search="?q=tea&category=food" />)

    expect(replaceSpy).toHaveBeenCalledTimes(1)
    expect(replaceSpy).toHaveBeenCalledWith({}, '', '/en/discover?q=tea&category=food')
    expect(window.location.pathname).toBe('/en/discover')
    expect(window.location.search).toBe('?q=tea&category=food')
  })

  it('calls skipNextPageview before replaceState', () => {
    render(<DiscoverUrlSync search="?q=tea&category=food" />)

    expect(mockSkipNextPageview).toHaveBeenCalledTimes(1)
    const skipOrder = mockSkipNextPageview.mock.invocationCallOrder[0] ?? Infinity
    const replaceOrder = replaceSpy.mock.invocationCallOrder[0] ?? -Infinity
    expect(skipOrder).toBeLessThan(replaceOrder)
  })

  it('no-op when target equals location.search', () => {
    render(<DiscoverUrlSync search="?q=tea" />)

    expect(mockSkipNextPageview).not.toHaveBeenCalled()
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('renders nothing', () => {
    const { container } = render(<DiscoverUrlSync search="?q=tea" />)

    expect(container).toBeEmptyDOMElement()
  })
})
