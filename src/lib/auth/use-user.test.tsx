// @vitest-environment jsdom
import { createElement } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ViewerContext } from '@/lib/actions/viewer-context'

const getViewerContextAction = vi.hoisted(() => vi.fn())
const captureException = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/viewer-context', () => ({ getViewerContextAction }))
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@sentry/nextjs', () => ({ captureException }))

const { ViewerProvider, useUser } = await import('./use-user')

const ADMIN_VIEWER: ViewerContext = {
  user: {
    id: '6c9e392e-04d5-4ca2-b008-c07a17f39f26',
    email: 'maría.garcía+test@company.co.uk',
    provider: 'email',
  },
  isAdmin: true,
}

const SESSION_COOKIE = 'sb-ttkkyvgvcamfoezsetvf-auth-token'

function setSessionCookie(present: boolean) {
  document.cookie = present
    ? `${SESSION_COOKIE}=base64-eyJ; path=/`
    : `${SESSION_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`
}

/**
 * The action POST's status reaches the classifier only through Resource
 * Timing, so tests pin the entry the browser would have recorded.
 */
function stubActionStatus(status: number) {
  Object.defineProperty(performance, 'getEntriesByName', {
    configurable: true,
    value: () => [{ initiatorType: 'fetch', responseStatus: status }],
  })
}

function renderViewer() {
  return renderHook(() => useUser(), {
    wrapper: ({ children }) => createElement(ViewerProvider, null, children),
  })
}

describe('ViewerProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setSessionCookie(true)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    setSessionCookie(false)
    Reflect.deleteProperty(performance, 'getEntriesByName')
    delete document.documentElement.dataset.viewerState
  })

  it('resolves an anonymous visitor locally without calling the server', async () => {
    setSessionCookie(false)

    const { result } = renderViewer()
    await waitFor(() => expect(result.current.viewerLoading).toBe(false))

    // Every anonymous page view used to POST this action (and on staging, 403).
    expect(getViewerContextAction).not.toHaveBeenCalled()
    expect(result.current.user).toBeNull()
    expect(result.current.viewer.isAdmin).toBe(false)
    expect(result.current.viewerError).toBe(false)
    expect(document.documentElement.dataset.viewerState).toBe('ready')
  })

  it('fetches again once a session cookie appears, as after sign-in', async () => {
    setSessionCookie(false)
    getViewerContextAction.mockResolvedValue(ADMIN_VIEWER)

    const { result } = renderViewer()
    await waitFor(() => expect(result.current.viewerLoading).toBe(false))
    expect(getViewerContextAction).not.toHaveBeenCalled()

    setSessionCookie(true)
    await act(() => result.current.refreshViewer())

    expect(getViewerContextAction).toHaveBeenCalledTimes(1)
    expect(result.current.viewer.isAdmin).toBe(true)
  })

  it('resolves user and viewer state with one server request', async () => {
    getViewerContextAction.mockResolvedValue(ADMIN_VIEWER)

    const { result } = renderViewer()
    await waitFor(() => expect(result.current.viewerLoading).toBe(false))

    expect(getViewerContextAction).toHaveBeenCalledTimes(1)
    expect(result.current.user).toEqual(ADMIN_VIEWER.user)
    expect(result.current.viewer.isAdmin).toBe(true)
    expect(result.current.viewerError).toBe(false)
  })

  it('recovers from a single network failure instead of hiding admin UI', async () => {
    getViewerContextAction
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(ADMIN_VIEWER)

    const { result } = renderViewer()
    await waitFor(() => expect(result.current.viewerLoading).toBe(false))

    expect(getViewerContextAction).toHaveBeenCalledTimes(2)
    expect(result.current.viewer.isAdmin).toBe(true)
    expect(result.current.viewerError).toBe(false)
  })

  it('retries a 5xx reply once', async () => {
    stubActionStatus(503)
    getViewerContextAction
      .mockRejectedValueOnce(new Error('An unexpected response was received from the server.'))
      .mockResolvedValue(ADMIN_VIEWER)

    const { result } = renderViewer()
    await waitFor(() => expect(result.current.viewerLoading).toBe(false))

    expect(getViewerContextAction).toHaveBeenCalledTimes(2)
    expect(result.current.viewer.isAdmin).toBe(true)
  })

  it.each([403, 429])(
    'sends one request, not two, when the reply is a %i',
    async (status) => {
      stubActionStatus(status)
      getViewerContextAction.mockRejectedValue(
        new Error('An unexpected response was received from the server.'),
      )

      const { result } = renderViewer()
      await waitFor(() => expect(result.current.viewerLoading).toBe(false))

      expect(getViewerContextAction).toHaveBeenCalledTimes(1)
      expect(result.current.viewerError).toBe(true)
    },
  )

  it('fails closed and reports when the viewer fetch never succeeds', async () => {
    getViewerContextAction.mockRejectedValue(new Error('down'))

    const { result } = renderViewer()
    await waitFor(() => expect(result.current.viewerLoading).toBe(false))

    // The security-critical invariant: a throwing action must never grant a
    // privilege. `viewerError` is what makes this distinguishable from a
    // legitimate "resolved, not an admin" — without it both are silence.
    expect(result.current.viewer.isAdmin).toBe(false)
    expect(result.current.viewerError).toBe(true)
  })

  it("reports the router's non-RSC 404 as deployment skew at warning", async () => {
    stubActionStatus(404)
    getViewerContextAction.mockRejectedValue(
      new Error('An unexpected response was received from the server.'),
    )

    const { result } = renderViewer()
    await waitFor(() => expect(captureException).toHaveBeenCalledTimes(1))

    expect(captureException.mock.calls[0]?.[1]).toEqual({
      level: 'warning',
      tags: { scope: 'viewer-context', deployment_skew: true },
    })
    expect(result.current.viewer.isAdmin).toBe(false)
    expect(result.current.viewerError).toBe(true)
  })

  it.each([403, 429, 500])(
    'reports a non-RSC %i at error level with its status, not as skew',
    async (status) => {
      stubActionStatus(status)
      getViewerContextAction.mockRejectedValue(
        new Error('An unexpected response was received from the server.'),
      )

      renderViewer()
      await waitFor(() => expect(captureException).toHaveBeenCalledTimes(1))

      expect(captureException.mock.calls[0]?.[1]).toEqual({
        level: 'error',
        tags: { scope: 'viewer-context', http_status: status },
      })
    },
  )

  it('still reports an unrelated viewer failure at error level', async () => {
    getViewerContextAction.mockRejectedValue(new Error('down'))

    const { result } = renderViewer()
    await waitFor(() => expect(captureException).toHaveBeenCalledTimes(1))

    expect(captureException.mock.calls[0]?.[1]).toEqual({
      level: 'error',
      tags: { scope: 'viewer-context' },
    })
    expect(result.current.viewer.isAdmin).toBe(false)
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
