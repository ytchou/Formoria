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

import { consumePageviewSkip, skipNextPageview } from '@/lib/analytics/pageview-skip'

import { PublicGoogleAnalytics } from './public-google-analytics'

const GA_ID = 'G-TESTID0000'

type GtagCall = unknown[]

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
    // Module-level flag: make sure no skip leaks between tests.
    consumePageviewSkip()
  })

  afterEach(() => {
    consumePageviewSkip()
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

  it('consumes a pending skip and does not send page_view for that URL change', () => {
    mockSearch = 'q=tea'
    const { rerender } = render(<PublicGoogleAnalytics gaId={GA_ID} />)
    expect(pageViews(gtag)).toHaveLength(1)

    skipNextPageview()
    mockSearch = 'q=tea&category=food'
    rerender(<PublicGoogleAnalytics gaId={GA_ID} />)

    expect(pageViews(gtag)).toHaveLength(1)
    // The skip was consumed by the effect.
    expect(consumePageviewSkip()).toBe(false)
  })

  it('sends page_view normally when no skip is pending, including after a consumed skip', () => {
    mockSearch = 'category=food'
    const { rerender } = render(<PublicGoogleAnalytics gaId={GA_ID} />)
    expect(pageViews(gtag)).toHaveLength(1)

    mockSearch = 'category=home'
    rerender(<PublicGoogleAnalytics gaId={GA_ID} />)
    expect(pageViews(gtag)).toHaveLength(2)

    skipNextPageview()
    mockSearch = 'category=home&sub=kitchen'
    rerender(<PublicGoogleAnalytics gaId={GA_ID} />)
    expect(pageViews(gtag)).toHaveLength(2)

    mockSearch = 'category=beauty'
    rerender(<PublicGoogleAnalytics gaId={GA_ID} />)
    const views = pageViews(gtag)
    expect(views).toHaveLength(3)
    expect(views[2]?.page_path).toBe('/discover?category=beauty')
  })
})
