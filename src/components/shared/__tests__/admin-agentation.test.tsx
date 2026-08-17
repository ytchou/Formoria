/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useUser: vi.fn() }))

vi.mock('@/lib/auth/use-user', () => ({ useUser: mocks.useUser }))

// The real toolbar is a ~430KB third-party bundle behind next/dynamic. Standing
// in a marker keeps this a test of the gate, not of Agentation itself.
vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="agentation-toolbar" />,
}))

import { AdminAgentation } from '../admin-agentation'

function setViewer({
  isAdmin = false,
  viewerLoading = false,
}: { isAdmin?: boolean; viewerLoading?: boolean } = {}) {
  mocks.useUser.mockReturnValue({ viewer: { isAdmin }, viewerLoading })
}

function toolbar(container: HTMLElement) {
  return container.querySelector('[data-testid="agentation-toolbar"]')
}

describe('AdminAgentation', () => {
  beforeEach(() => {
    mocks.useUser.mockReset()
    // jsdom leaves navigator.webdriver undefined, which is the non-automated
    // case. The suppression itself is asserted explicitly below.
    Object.defineProperty(navigator, 'webdriver', {
      value: false,
      configurable: true,
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('renders for a non-admin on a local dev server', () => {
    // The bug this covers: ADMIN_EMAILS is empty in .env.local, so every
    // developer is a non-admin locally and the toolbar silently never mounted.
    vi.stubEnv('NODE_ENV', 'development')
    setViewer({ isAdmin: false })

    const { container } = render(<AdminAgentation />)

    expect(toolbar(container)).not.toBeNull()
  })

  it('stays admin-only in deployed environments', () => {
    vi.stubEnv('NODE_ENV', 'production')
    setViewer({ isAdmin: false })

    const { container } = render(<AdminAgentation />)

    expect(toolbar(container)).toBeNull()
  })

  it('renders for an admin in deployed environments', () => {
    vi.stubEnv('NODE_ENV', 'production')
    setViewer({ isAdmin: true })

    const { container } = render(<AdminAgentation />)

    expect(toolbar(container)).not.toBeNull()
  })

  it('stays hidden while the viewer is still loading', () => {
    vi.stubEnv('NODE_ENV', 'development')
    setViewer({ isAdmin: false, viewerLoading: true })

    const { container } = render(<AdminAgentation />)

    expect(toolbar(container)).toBeNull()
  })

  it('stays hidden under automation, including in development', () => {
    // A floating toolbar intercepts Playwright's clicks, so the dev carve-out
    // must not resurrect it for the e2e suite.
    vi.stubEnv('NODE_ENV', 'development')
    Object.defineProperty(navigator, 'webdriver', {
      value: true,
      configurable: true,
    })
    setViewer({ isAdmin: true })

    const { container } = render(<AdminAgentation />)

    expect(toolbar(container)).toBeNull()
  })
})
