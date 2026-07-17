// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewerProvider, useUser } from './use-user'

const authMocks = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  getUser: vi.fn().mockResolvedValue({
    data: { user: { id: 'user-niizo', email: 'owner@niizo.tw' } },
    error: null,
  }),
  onAuthStateChange: vi.fn(),
  getViewerContextAction: vi.fn(),
}))

const navigationMocks = vi.hoisted(() => ({ pathname: '/auth/sign-in' }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationMocks.pathname,
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: authMocks.getUser,
      onAuthStateChange: authMocks.onAuthStateChange,
    },
  }),
}))

vi.mock('@/lib/actions/viewer-context', () => ({
  getViewerContextAction: authMocks.getViewerContextAction,
}))

function Probe() {
  const { user, loading, viewer, viewerLoading, refreshViewer } = useUser()
  return (
    <div>
      <span>
        {loading || viewerLoading
          ? 'loading'
          : `${user?.email ?? 'anonymous'}:${viewer.hasOwnedBrand}`}
      </span>
      <span data-testid="auth-provider">{user?.provider ?? 'none'}</span>
      <button type="button" onClick={() => void refreshViewer()}>
        Refresh viewer
      </button>
    </div>
  )
}

describe('ViewerProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-niizo', email: 'owner@niizo.tw' } },
      error: null,
    })
    authMocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: authMocks.unsubscribe } },
    })
    authMocks.getViewerContextAction.mockResolvedValue({
      hasOwnedBrand: true,
      isAdmin: false,
      impersonation: null,
    })
  })

  it('loads auth once and resolves server-verified viewer context', async () => {
    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('owner@niizo.tw:true')).toBeInTheDocument()
    })
    expect(authMocks.getUser).toHaveBeenCalledTimes(1)
    expect(authMocks.getViewerContextAction).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('auth-provider')).toHaveTextContent('email')
  })

  it('fails closed and finishes loading when viewer context cannot be loaded', async () => {
    authMocks.getViewerContextAction.mockRejectedValueOnce(
      new Error('viewer context unavailable'),
    )

    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    )

    expect(
      await screen.findByText('owner@niizo.tw:false'),
    ).toBeInTheDocument()
  })

  it('does not restore stale viewer data after a sign-out event', async () => {
    let authStateCallback: ((event: string, session: null) => void) | null = null
    let resolveViewer: (viewer: {
      hasOwnedBrand: boolean
      isAdmin: boolean
      impersonation: null
    }) => void = () => {}
    authMocks.onAuthStateChange.mockImplementation((callback) => {
      authStateCallback = callback
      return {
        data: { subscription: { unsubscribe: authMocks.unsubscribe } },
      }
    })
    authMocks.getViewerContextAction.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveViewer = resolve
      }),
    )

    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    )

    await waitFor(() => {
      expect(authMocks.getViewerContextAction).toHaveBeenCalledTimes(1)
    })
    act(() => authStateCallback?.('SIGNED_OUT', null))
    await act(async () => {
      resolveViewer({
        hasOwnedBrand: true,
        isAdmin: false,
        impersonation: null,
      })
    })

    expect(await screen.findByText('anonymous:false')).toBeInTheDocument()
  })

  it('fails closed when a manual viewer refresh rejects', async () => {
    render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    )
    await screen.findByText('owner@niizo.tw:true')

    authMocks.getViewerContextAction.mockRejectedValueOnce(
      new Error('refresh failed'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh viewer' }))

    expect(
      await screen.findByText('owner@niizo.tw:false'),
    ).toBeInTheDocument()
  })

  it('rechecks the server-written session after a server action changes the route', async () => {
    authMocks.getUser
      .mockResolvedValueOnce({ data: { user: null }, error: null })
      .mockResolvedValueOnce({
        data: { user: { id: 'user-niizo', email: 'owner@niizo.tw' } },
        error: null,
      })

    const rendered = render(
      <ViewerProvider>
        <Probe />
      </ViewerProvider>,
    )

    expect(await screen.findByText('anonymous:false')).toBeInTheDocument()

    navigationMocks.pathname = '/dashboard'
    await act(async () => {
      rendered.rerender(
        <ViewerProvider>
          <Probe />
        </ViewerProvider>,
      )
    })

    expect(await screen.findByText('owner@niizo.tw:true')).toBeInTheDocument()
    expect(authMocks.getUser).toHaveBeenCalledTimes(2)
  })
})
