/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockPathname = '/discover'
let mockSearch = ''

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

vi.mock('next/script', () => ({ default: () => null }))

import { shouldSkipPageview, skipPageviewFor } from '@/lib/analytics/pageview-skip'
import { DiscoverUrlSync } from '@/components/products/discover-url-sync'

import { PublicGoogleAnalytics } from './public-google-analytics'

const GA_ID = 'G-TESTID0000'

type GtagCall = unknown[]

// No real page path is empty, so this clears any pending skip.
function clearPendingSkip() {
  shouldSkipPageview('')
}

// Simulates a hard document load: the browser URL and the router's search params agree.
function loadDocument(search: string) {
  mockSearch = search
  window.history.replaceState({}, '', `${mockPathname}${search ? `?${search}` : ''}`)
}

// Simulates the router reporting the URL after a history.replaceState.
function syncRouterToLocation() {
  mockSearch = window.location.search.replace(/^\?/, '')
}

function pageViews(gtag: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return (gtag.mock.calls as GtagCall[])
    .filter((call) => call[0] === 'event' && call[1] === 'page_view')
    .map((call) => call[2] as Record<string, unknown>)
}

describe('PublicGoogleAnalytics', () => {
  let gtag: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockPathname = '/discover'
    mockSearch = ''
    gtag = vi.fn()
    window.gtag = gtag as unknown as typeof window.gtag
    window.history.replaceState({}, '', '/discover')
    // Module-level state: make sure no skip leaks between tests.
    clearPendingSkip()
  })

  afterEach(() => {
    clearPendingSkip()
  })

  it('strips q, search, infer and inferred from page_location and page_path', () => {
    mockSearch = 'q=my+secret&search=typed&infer=1&inferred=category&category=food&sub=snacks&material=wood'
    render(<PublicGoogleAnalytics gaId={GA_ID} />)

    const [view] = pageViews(gtag)
    expect(view).toBeDefined()
    const pagePath = view.page_path as string
    const pageLocation = view.page_location as string
    for (const value of [pagePath, pageLocation]) {
      expect(value).not.toMatch(/[?&]q=/)
      expect(value).not.toMatch(/[?&]search=/)
      expect(value).not.toMatch(/[?&]infer=/)
      expect(value).not.toMatch(/[?&]inferred=/)
      expect(value).not.toContain('secret')
    }
    expect(pagePath).toBe('/discover?category=food&sub=snacks&material=wood')
    expect(pageLocation).toBe(`${window.location.origin}/discover?category=food&sub=snacks&material=wood`)
  })

  it('skips the page_view for a registered rewrite target and remembers it', () => {
    mockSearch = 'category=food'
    const { rerender } = render(<PublicGoogleAnalytics gaId={GA_ID} />)
    expect(pageViews(gtag)).toHaveLength(1)

    skipPageviewFor('/discover?category=food', '/discover?category=food&sub=snacks')
    mockSearch = 'category=food&sub=snacks'
    rerender(<PublicGoogleAnalytics gaId={GA_ID} />)
    expect(pageViews(gtag)).toHaveLength(1)
    // The skip was consumed.
    expect(shouldSkipPageview('/discover?category=food&sub=snacks')).toBe(false)

    // Re-reporting the skipped path (e.g. a stripped param changes) is deduped.
    mockSearch = 'category=food&sub=snacks&q=tea'
    rerender(<PublicGoogleAnalytics gaId={GA_ID} />)
    expect(pageViews(gtag)).toHaveLength(1)
  })

  it('does not let a stale skip swallow a later unrelated navigation', () => {
    mockSearch = 'category=food'
    const { rerender } = render(<PublicGoogleAnalytics gaId={GA_ID} />)
    expect(pageViews(gtag)).toHaveLength(1)

    skipPageviewFor('/discover?category=food', '/discover?category=food&sub=snacks')
    mockSearch = 'category=beauty'
    rerender(<PublicGoogleAnalytics gaId={GA_ID} />)
    expect(pageViews(gtag)).toHaveLength(2)

    // The unmatched skip was discarded, so its former target now counts too.
    mockSearch = 'category=food&sub=snacks'
    rerender(<PublicGoogleAnalytics gaId={GA_ID} />)
    const views = pageViews(gtag)
    expect(views).toHaveLength(3)
    expect(views[2]?.page_path).toBe('/discover?category=food&sub=snacks')
  })

  it('always sends the first page_view of a document, even if a skip targets it', () => {
    skipPageviewFor('/discover', '/discover?category=home')
    mockSearch = 'category=home'
    render(<PublicGoogleAnalytics gaId={GA_ID} />)

    expect(pageViews(gtag)).toHaveLength(1)
    expect(shouldSkipPageview('/discover?category=home')).toBe(false)
  })
})

// DiscoverUrlSync renders inside the page (children), before GA in the root document,
// so its effect runs first. These tests mount them as siblings in that order.
describe('DiscoverUrlSync + PublicGoogleAnalytics', () => {
  let gtag: ReturnType<typeof vi.fn>

  function tree(search: string) {
    return (
      <>
        <DiscoverUrlSync search={search} />
        <PublicGoogleAnalytics gaId={GA_ID} />
      </>
    )
  }

  function expectScrubbed(view: Record<string, unknown> | undefined) {
    expect(view).toBeDefined()
    for (const value of [view?.page_location as string, view?.page_path as string]) {
      expect(value).not.toMatch(/[?&](q|infer|inferred)=/)
    }
  }

  beforeEach(() => {
    mockPathname = '/discover'
    mockSearch = ''
    gtag = vi.fn()
    window.gtag = gtag as unknown as typeof window.gtag
    window.history.replaceState({}, '', '/discover')
    clearPendingSkip()
  })

  afterEach(() => {
    clearPendingSkip()
  })

  it('(a) hard-loaded submit with no inferred filters logs exactly one page_view', () => {
    loadDocument('infer=1&q=tea')
    const { rerender } = render(tree('?q=tea'))
    expect(window.location.search).toBe('?q=tea')

    syncRouterToLocation()
    rerender(tree('?q=tea'))

    const views = pageViews(gtag)
    expect(views).toHaveLength(1)
    expectScrubbed(views[0])
    expect(views[0]?.page_path).toBe('/discover')
  })

  it('(b) hard-loaded submit with inferred filters logs exactly one page_view', () => {
    const target = '?q=tea&category=home&inferred=category'
    loadDocument('infer=1&q=tea')
    const { rerender } = render(tree(target))
    expect(window.location.search).toBe(target)
    expect(pageViews(gtag)).toHaveLength(1)

    syncRouterToLocation()
    rerender(tree(target))

    const views = pageViews(gtag)
    expect(views).toHaveLength(1)
    expectScrubbed(views[0])
  })

  it('(c) soft navigation reordered by the sync logs exactly one page_view', () => {
    loadDocument('q=x')
    const { rerender } = render(tree('?q=x'))
    expect(pageViews(gtag)).toHaveLength(1)

    // Sidebar link: routes.discover({ category, q }) serialises category first.
    window.history.pushState({}, '', '/discover?category=c&q=x')
    mockSearch = 'category=c&q=x'
    rerender(tree('?q=x&category=c'))
    expect(window.location.search).toBe('?q=x&category=c')

    syncRouterToLocation()
    rerender(tree('?q=x&category=c'))

    const views = pageViews(gtag)
    expect(views).toHaveLength(2)
    expect(views[1]?.page_path).toBe('/discover?category=c')
  })

  it('(c) soft navigation whose kept params are reordered logs exactly one page_view', () => {
    loadDocument('q=x')
    const { rerender } = render(tree('?q=x'))
    expect(pageViews(gtag)).toHaveLength(1)

    window.history.pushState({}, '', '/discover?sub=s&category=c&q=x')
    mockSearch = 'sub=s&category=c&q=x'
    rerender(tree('?q=x&category=c&sub=s'))
    expect(window.location.search).toBe('?q=x&category=c&sub=s')

    syncRouterToLocation()
    rerender(tree('?q=x&category=c&sub=s'))

    expect(pageViews(gtag)).toHaveLength(2)
  })
})
