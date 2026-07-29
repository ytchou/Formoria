'use client'

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'

import {
  getViewerContextAction,
  type ViewerContext,
} from '@/lib/actions/viewer-context'
import { createClient } from '@/lib/supabase/client'

type ViewerUser = {
  id: string
  email: string | null
  provider: string
}

type UseUserState = {
  user: ViewerUser | null
  loading: boolean
  viewer: ViewerContext
  viewerLoading: boolean
  refreshViewer: () => Promise<void>
}

const EMPTY_VIEWER_CONTEXT: ViewerContext = {
  hasOwnedBrand: false,
  isAdmin: false,
  // Fail closed: owner surfaces stay hidden until the server says otherwise.
  ownerFeaturesEnabled: false,
  impersonation: null,
}

/**
 * De-duplication key for the signed-out viewer request. A user id is a UUID, so
 * this sentinel can never collide with an authenticated key.
 */
const ANONYMOUS_VIEWER_KEY = 'anonymous'

const UserContext = createContext<UseUserState | null>(null)

function toViewerUser(user: {
  id: string
  email?: string | null
  app_metadata?: { provider?: string }
} | null): ViewerUser | null {
  return user
    ? {
        id: user.id,
        email: user.email ?? null,
        provider: user.app_metadata?.provider ?? 'email',
      }
    : null
}

export function ViewerProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const previousPathname = useRef(pathname)
  const reloadAuthRef = useRef<(() => Promise<void>) | null>(null)
  const viewerRequestRef = useRef<{
    viewerKey: string
    promise: Promise<ViewerContext>
  } | null>(null)
  const [state, setState] = useState<Omit<UseUserState, 'refreshViewer'>>({
    user: null,
    loading: true,
    viewer: EMPTY_VIEWER_CONTEXT,
    viewerLoading: true,
  })
  const refreshViewer = useCallback(async () => {
    setState((current) => ({ ...current, viewerLoading: true }))
    let viewer = EMPTY_VIEWER_CONTEXT
    try {
      viewer = await getViewerContextAction()
    } catch {
      // Viewer state controls privileged UI, so failures must resolve closed.
    }
    setState((current) =>
      current.user?.id === state.user?.id
        ? { ...current, viewer, viewerLoading: false }
        : current,
    )
  }, [state.user?.id])

  useEffect(() => {
    const supabase = createClient()
    let authEventVersion = 0
    let authRequestId = 0
    let active = true
    let viewerRequestId = 0

    // Auth initialization and Supabase's INITIAL_SESSION event can overlap.
    // `viewerKey` is a user id, or ANONYMOUS_VIEWER_KEY for signed-out visitors —
    // both need viewer context, so both take part in the de-duplication.
    function loadViewerContext(viewerKey: string): Promise<ViewerContext> {
      const previousRequest = viewerRequestRef.current
      if (previousRequest?.viewerKey === viewerKey) {
        return previousRequest.promise
      }

      const request = getViewerContextAction()
      viewerRequestRef.current = { viewerKey, promise: request }
      const clearRequest = () => {
        if (viewerRequestRef.current?.promise === request) {
          viewerRequestRef.current = null
        }
      }
      void request.then(clearRequest, clearRequest)
      return request
    }

    async function setAuthenticatedUser(user: ViewerUser | null) {
      const requestId = ++viewerRequestId
      if (!active) return

      // Signed-out visitors are the claim funnel's entry point, so they need the
      // owner-features flag too — the anonymous branch fetches viewer context
      // instead of settling on the closed default. Privileged fields are reset
      // to the closed default up front so a sign-out cannot leave admin or owner
      // UI on screen while the anonymous fetch is in flight.
      setState((current) =>
        user
          ? { ...current, user, loading: false, viewerLoading: true }
          : {
              user: null,
              loading: false,
              viewer: EMPTY_VIEWER_CONTEXT,
              viewerLoading: true,
            },
      )

      let viewer = EMPTY_VIEWER_CONTEXT
      try {
        viewer = await loadViewerContext(user?.id ?? ANONYMOUS_VIEWER_KEY)
      } catch {
        // Viewer state controls privileged UI, so failures must resolve closed.
      }
      if (!active || requestId !== viewerRequestId) {
        return
      }
      setState({ user, loading: false, viewer, viewerLoading: false })
    }

    async function loadUser(authClient = supabase) {
      const requestId = ++authRequestId
      const initialAuthEventVersion = authEventVersion
      const { data, error } = await authClient.auth.getUser()

      if (
        !active ||
        requestId !== authRequestId ||
        authEventVersion !== initialAuthEventVersion
      ) {
        return
      }

      if (error) {
        await setAuthenticatedUser(null)
        return
      }

      await setAuthenticatedUser(toViewerUser(data.user))
    }

    reloadAuthRef.current = () => loadUser(createClient())
    void loadUser()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventVersion += 1
      void setAuthenticatedUser(toViewerUser(session?.user ?? null))
    })

    return () => {
      active = false
      reloadAuthRef.current = null
      viewerRequestId += 1
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (previousPathname.current === pathname) return

    previousPathname.current = pathname
    void reloadAuthRef.current?.()
  }, [pathname])

  return createElement(
    UserContext.Provider,
    { value: { ...state, refreshViewer } },
    children,
  )
}

export function useUser(): UseUserState {
  const state = useContext(UserContext)
  if (!state) throw new Error('useUser must be used within ViewerProvider')
  return state
}
