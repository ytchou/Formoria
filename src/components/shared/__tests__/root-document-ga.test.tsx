/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Stand-in for the GA4 snippet. The real component pulls in next/script and the
// router hooks; what is under test is whether RootDocument renders it at all.
vi.mock('@/components/analytics/public-google-analytics', () => ({
  PublicGoogleAnalytics: ({ gaId }: { gaId: string }) => (
    <div data-testid="ga-snippet" data-ga-id={gaId} />
  ),
}))

// Siblings of the GA branch, each with its own network or provider dependency.
vi.mock('@/lib/auth/use-user', () => ({
  ViewerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useUser: () => ({ user: null, viewer: null, viewerLoading: false }),
}))
vi.mock('@/components/analytics/ga-user-sync', () => ({ GaUserSync: () => null }))
vi.mock('@/components/analytics/posthog-user-sync', () => ({
  PostHogUserSync: () => null,
}))
vi.mock('@/components/analytics/web-vitals-reporter', () => ({
  WebVitalsReporter: () => null,
}))
vi.mock('@/components/shared/admin-agentation', () => ({
  AdminAgentation: () => null,
}))

import { RootDocument } from '../root-document'

const GA_ID = 'G-TESTID0000'

function renderDocument() {
  // RootDocument owns <html>/<body>, which cannot nest in the default container.
  const container = document.createElement('div')
  return render(
    <RootDocument locale="zh-TW" skipToContentLabel="skip">
      <main />
    </RootDocument>,
    { container: document.body.appendChild(container) },
  )
}

function snippet(container: HTMLElement) {
  return container.querySelector('[data-testid="ga-snippet"]')
}

describe('RootDocument GA4 gate', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('does not activate page-wide hosted CJK fonts', () => {
    // The regression: a Chinese-rich brand page activated 32 font files and
    // transferred 2.4 MiB before LCP, despite both families being non-critical.
    renderDocument()

    expect(document.documentElement.className).not.toMatch(
      /font-noto-(?:serif|sans)-tc/,
    )
  })

  it('renders no snippet on staging, even with the measurement ID present', () => {
    // The bug: a non-production build carrying the production measurement ID
    // wrote to the production property, and GA4 cannot delete those sessions
    // after the fact.
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_DEPLOYMENT_ENV', 'staging')
    vi.stubEnv('NEXT_PUBLIC_GA_ID', GA_ID)

    const { container } = renderDocument()

    expect(snippet(container)).toBeNull()
  })

  it('renders no snippet on the Railway staging service, which sets no NEXT_PUBLIC_DEPLOYMENT_ENV', () => {
    // Railway staging signals itself only through RAILWAY_ENVIRONMENT_NAME.
    // Gating on NEXT_PUBLIC_DEPLOYMENT_ENV alone would pass here and gate
    // nothing — this case is why the predicate calls isStagingEnvironment().
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_DEPLOYMENT_ENV', '')
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'staging')
    vi.stubEnv('NEXT_PUBLIC_GA_ID', GA_ID)

    const { container } = renderDocument()

    expect(snippet(container)).toBeNull()
  })

  it('renders no snippet in a non-production build', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_DEPLOYMENT_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_GA_ID', GA_ID)

    const { container } = renderDocument()

    expect(snippet(container)).toBeNull()
  })

  it('renders the snippet in the production deployment', () => {
    // The real production service sets no deployment-env variable — only
    // RAILWAY_ENVIRONMENT_NAME. An allow-list gate would black out GA here.
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_DEPLOYMENT_ENV', '')
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production')
    vi.stubEnv('NEXT_PUBLIC_GA_ID', GA_ID)

    const { container } = renderDocument()

    expect(snippet(container)?.getAttribute('data-ga-id')).toBe(GA_ID)
  })

  it('renders no snippet when the measurement ID is unset', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_DEPLOYMENT_ENV', '')
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production')
    vi.stubEnv('NEXT_PUBLIC_GA_ID', '')

    const { container } = renderDocument()

    expect(snippet(container)).toBeNull()
  })
})
