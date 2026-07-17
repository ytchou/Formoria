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
  impersonation: null,
}

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

    async function setAuthenticatedUser(user: ViewerUser | null) {
      const requestId = ++viewerRequestId
      if (!active) return

      if (!user) {
        setState({
          user: null,
          loading: false,
          viewer: EMPTY_VIEWER_CONTEXT,
          viewerLoading: false,
        })
        return
      }

      setState((current) => ({
        ...current,
        user,
        loading: false,
        viewerLoading: true,
      }))

      let viewer = EMPTY_VIEWER_CONTEXT
      try {
        viewer = await getViewerContextAction()
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
