// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUsePathname = vi.fn()
const mockUseSearchParams = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
  useSearchParams: () => mockUseSearchParams(),
}))

vi.mock('next/script', () => ({
  default: ({ id }: { id: string }) => <script data-testid={id} />,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockUseSearchParams.mockReturnValue(new URLSearchParams())
  window.gtag = vi.fn()
})

describe('PublicGoogleAnalytics', () => {
  it('does not initialize analytics on protected localized routes', async () => {
    mockUsePathname.mockReturnValue('/zh-TW/admin/brands')
    const { PublicGoogleAnalytics } = await import('./public-google-analytics')

    const { container } = render(<PublicGoogleAnalytics gaId="G-TEST" />)

    expect(container).toBeEmptyDOMElement()
    expect(window.gtag).not.toHaveBeenCalled()
  })

  it('defines a gtag shim that pushes arguments objects, not arrays', async () => {
    mockUsePathname.mockReturnValue('/en/brands')
    // @ts-expect-error -- simulate gtag.js not yet loaded
    delete window.gtag
    window.dataLayer = []
    const { PublicGoogleAnalytics } = await import('./public-google-analytics')

    render(<PublicGoogleAnalytics gaId="G-TEST" />)

    const commands = window.dataLayer
    expect(commands.length).toBeGreaterThanOrEqual(3)
    for (const entry of commands) {
      // gtag.js silently ignores commands pushed as plain arrays — it only
      // executes `arguments` objects (array-like, but not Array instances)
      expect(Array.isArray(entry)).toBe(false)
      expect(typeof (entry as { length?: number }).length).toBe('number')
    }
    expect((commands[0] as unknown as unknown[])[0]).toBe('js')
    expect((commands[1] as unknown as unknown[])[0]).toBe('config')
  })

  it('sends a manual page view for public routes', async () => {
    mockUsePathname.mockReturnValue('/en/brands')
    mockUseSearchParams.mockReturnValue(new URLSearchParams('category=food'))
    const { PublicGoogleAnalytics } = await import('./public-google-analytics')

    render(<PublicGoogleAnalytics gaId="G-TEST" />)

    expect(window.gtag).toHaveBeenCalledWith('event', 'page_view', {
      page_location: 'http://localhost/en/brands?category=food',
      page_path: '/en/brands?category=food',
      page_title: '',
    })
  })
})
