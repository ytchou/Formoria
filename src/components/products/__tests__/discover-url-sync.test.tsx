/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { shouldSkipPageview } from '@/lib/analytics/pageview-skip'

import { DiscoverUrlSync } from '../discover-url-sync'

// No real page path is empty, so this clears any pending skip.
function clearPendingSkip() {
  shouldSkipPageview('')
}

describe('DiscoverUrlSync', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/en/discover?q=tea')
    clearPendingSkip()
  })

  afterEach(() => {
    clearPendingSkip()
  })

  it('replaces the URL with pathname + target, keeping the locale prefix and hash', () => {
    window.history.replaceState({}, '', '/en/discover?q=tea#results')
    render(<DiscoverUrlSync search="?q=tea&category=food" />)

    expect(window.location.pathname).toBe('/en/discover')
    expect(window.location.search).toBe('?q=tea&category=food')
    expect(window.location.hash).toBe('#results')
  })

  it('registers a skip from the scrubbed current path to the scrubbed target when they differ', () => {
    window.history.replaceState({}, '', '/en/discover?infer=1&q=tea')
    render(<DiscoverUrlSync search="?q=tea&category=home&inferred=category" />)

    expect(window.location.search).toBe('?q=tea&category=home&inferred=category')
    // The current (from) path keeps the skip pending; the target consumes it.
    expect(shouldSkipPageview('/en/discover')).toBe(false)
    expect(shouldSkipPageview('/en/discover?category=home')).toBe(true)
    expect(shouldSkipPageview('/en/discover?category=home')).toBe(false)
  })

  it('rewrites the URL but registers no skip when only stripped params change', () => {
    window.history.replaceState({}, '', '/en/discover?infer=1&q=tea')
    render(<DiscoverUrlSync search="?q=tea" />)

    expect(window.location.search).toBe('?q=tea')
    expect(shouldSkipPageview('/en/discover')).toBe(false)
    expect(shouldSkipPageview('/en/discover?q=tea')).toBe(false)
  })

  it('rewrites a key-order-only difference without registering a skip', () => {
    window.history.replaceState({}, '', '/en/discover?category=c&q=x')
    render(<DiscoverUrlSync search="?q=x&category=c" />)

    expect(window.location.search).toBe('?q=x&category=c')
    expect(shouldSkipPageview('/en/discover?category=c')).toBe(false)
  })

  it('does nothing when the target equals location.search', () => {
    render(<DiscoverUrlSync search="?q=tea" />)

    expect(window.location.search).toBe('?q=tea')
    expect(shouldSkipPageview('/en/discover')).toBe(false)
  })

  it('renders nothing', () => {
    const { container } = render(<DiscoverUrlSync search="?q=tea" />)

    expect(container).toBeEmptyDOMElement()
  })
})
