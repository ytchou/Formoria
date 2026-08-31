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
  user: {
    id: '6c9e392e-04d5-4ca2-b008-c07a17f39f26',
    email: 'maría.garcía+test@company.co.uk',
    provider: 'email',
  },
  isAdmin: true,
}

function renderViewer() {
  return renderHook(() => useUser(), {
    wrapper: ({ children }) => createElement(ViewerProvider, null, children),
  })
}

describe('ViewerProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    delete document.documentElement.dataset.viewerState
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
