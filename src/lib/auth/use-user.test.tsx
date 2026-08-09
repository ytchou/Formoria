// @vitest-environment jsdom
import { createElement } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ViewerContext } from '@/lib/actions/viewer-context'

const getViewerContextAction = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/viewer-context', () => ({ getViewerContextAction }))
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

const { ViewerProvider, useUser } = await import('./use-user')

const ADMIN_VIEWER: ViewerContext = {
  hasOwnedBrand: false,
  isAdmin: true,
  ownerFeaturesEnabled: true,
  impersonation: null,
}

function renderViewer() {
  return renderHook(() => useUser(), {
    wrapper: ({ children }) => createElement(ViewerProvider, null, children),
  })
}

/**
 * These cover the invariants that make the DEV-1414 fix safe rather than just
 * fast. There is no signed-in session here, so the auth lookup resolves to the
 * anonymous branch — which is the path that adopts the mount-time viewer fetch,
 * and therefore the path that proves the two round trips overlap.
 */
describe('ViewerProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The Supabase browser client is constructed for real — `check-test-boundaries`
    // forbids mocking `@/lib/supabase/*`, and rightly so. It is given credentials
    // that resolve to nothing and a transport that always fails, so `getUser()`
    // returns an error and the provider takes its anonymous branch deterministically,
    // with no network access.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:1')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline in unit tests'))),
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    delete document.documentElement.dataset.viewerState
  })

  it('issues one viewer request, not one per auth phase', async () => {
    getViewerContextAction.mockResolvedValue(ADMIN_VIEWER)

    const { result } = renderViewer()
    await waitFor(() => expect(result.current.viewerLoading).toBe(false))

    // The mount-time request is primed under a speculative key and adopted when
    // auth resolves. If adoption ever breaks, this becomes 2 and the "parallel"
    // fetch is silently just an extra round trip.
    expect(getViewerContextAction).toHaveBeenCalledTimes(1)
    expect(result.current.viewer.isAdmin).toBe(true)
    expect(result.current.viewerError).toBe(false)
  })

  it('recovers from a single transient failure instead of hiding admin UI', async () => {
    getViewerContextAction
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue(ADMIN_VIEWER)

    const { result } = renderViewer()
    await waitFor(() => expect(result.current.viewerLoading).toBe(false))

    expect(getViewerContextAction).toHaveBeenCalledTimes(2)
    expect(result.current.viewer.isAdmin).toBe(true)
    expect(result.current.viewerError).toBe(false)
  })

  it('fails closed and reports when the viewer fetch never succeeds', async () => {
    getViewerContextAction.mockRejectedValue(new Error('down'))

    const { result } = renderViewer()
    await waitFor(() => expect(result.current.viewerLoading).toBe(false))

    // The security-critical invariant: a throwing action must never grant a
    // privilege. `viewerError` is what makes this distinguishable from a
    // legitimate "resolved, not an admin" — without it both are silence.
    expect(result.current.viewer.isAdmin).toBe(false)
    expect(result.current.viewer.hasOwnedBrand).toBe(false)
    expect(result.current.viewer.ownerFeaturesEnabled).toBe(false)
    expect(result.current.viewerError).toBe(true)
  })

  it('publishes a readiness signal that distinguishes ready from error', async () => {
    getViewerContextAction.mockResolvedValue(ADMIN_VIEWER)
    const ready = renderViewer()
    await waitFor(() =>
      expect(document.documentElement.dataset.viewerState).toBe('ready'),
    )
    ready.unmount()

    getViewerContextAction.mockRejectedValue(new Error('down'))
    renderViewer()
    await waitFor(() =>
      expect(document.documentElement.dataset.viewerState).toBe('error'),
    )
  })

  it('never starts with viewerLoading false', () => {
    getViewerContextAction.mockResolvedValue(ADMIN_VIEWER)

    // AdminAgentation reads `navigator` on the line after its `viewerLoading`
    // guard, and `navigator` is undefined during SSR. A false initial value
    // would move that read into the server render and throw.
    const { result } = renderViewer()
    expect(result.current.viewerLoading).toBe(true)
  })
})
