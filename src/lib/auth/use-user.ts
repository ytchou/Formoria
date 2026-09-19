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

type ViewerUser = NonNullable<ViewerContext['user']>

type UseUserState = {
  user: ViewerUser | null
  loading: boolean
  viewer: ViewerContext
  viewerLoading: boolean
  /**
   * True when viewer context could not be fetched and the state below is the
   * fail-closed default rather than the server's answer. Without this, "resolved
   * and not an admin" and "never resolved" are the same observable state, which
   * is what made a swallowed failure here look like a slow render (DEV-1414).
   */
  viewerError: boolean
  refreshViewer: () => Promise<void>
}

type ViewerProviderState = Omit<UseUserState, 'refreshViewer'> & {
  request: Promise<ViewerContext> | null
}

const EMPTY_VIEWER_CONTEXT: ViewerContext = {
  user: null,
  // Fail closed: privileged surfaces stay hidden until the server says otherwise.
  isAdmin: false,
}

/** One retry before settling closed; the failure is a network blip far more often than a real denial. */
const VIEWER_RETRY_DELAY_MS = 300

/**
 * Lazily imported so `@sentry/nextjs` stays out of every page's client bundle —
 * ViewerProvider mounts in the root document, so a static import here is global.
 */
function reportViewerFailure(error: unknown) {
  void import('@sentry/nextjs')
    .then(({ captureException }) => {
      captureException(error, { tags: { scope: 'viewer-context' } })
    })
    .catch(() => {
      // A failed telemetry chunk load must not surface as an app error.
    })
}

/**
 * One retry, then rethrow. Callers still resolve closed on a thrown error; the
 * retry only stops a single transient failure from hiding admin and owner
 * controls for the rest of the page's life, which it previously did silently.
 */
async function fetchViewerContextWithRetry(): Promise<ViewerContext> {
  try {
    return await getViewerContextAction()
  } catch {
    await new Promise((resolve) => setTimeout(resolve, VIEWER_RETRY_DELAY_MS))
    return await getViewerContextAction()
  }
}

const UserContext = createContext<UseUserState | null>(null)

export function ViewerProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const previousPathname = useRef(pathname)
  const [state, setState] = useState<ViewerProviderState>({
    user: null,
    loading: true,
    // Must start true: AdminAgentation reads `navigator` immediately after its
    // `viewerLoading` guard, and `navigator` is undefined during SSR.
    viewerLoading: true,
    viewer: EMPTY_VIEWER_CONTEXT,
    viewerError: false,
    request: null,
  })

  const refreshViewer = useCallback(async () => {
    const request = fetchViewerContextWithRetry()
    setState((current) => ({
      ...current,
      viewerLoading: true,
      viewerError: false,
      request,
    }))
    let viewer = EMPTY_VIEWER_CONTEXT
    let viewerError = false
    try {
      viewer = await request
    } catch (error) {
      // Viewer state controls privileged UI, so failures must resolve closed —
      // but they are now reported rather than swallowed.
      viewerError = true
      reportViewerFailure(error)
    }
    setState((current) =>
      current.request === request
        ? {
            user: viewer.user,
            loading: false,
            viewer,
            viewerLoading: false,
            viewerError,
            request: null,
          }
        : current,
    )
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshViewer(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshViewer])

  useEffect(() => {
    if (previousPathname.current === pathname) return

    previousPathname.current = pathname
    const timer = window.setTimeout(() => void refreshViewer(), 0)
    return () => window.clearTimeout(timer)
  }, [pathname, refreshViewer])

  // Readiness signal for tests. Admin- and owner-gated controls render `null`
  // until viewer context settles, so asserting one directly cannot tell "still
  // loading" from "resolved and hidden" from "the fetch failed" — every such
  // failure looked like a timeout and got repaired with a bigger number
  // (DEV-1414). `error` is a distinct value so a swallowed failure is assertable.
  // Set from an effect because ViewerProvider mounts inside <body>.
  useEffect(() => {
    document.documentElement.dataset.viewerState = state.viewerLoading
      ? 'loading'
      : state.viewerError
        ? 'error'
        : 'ready'
  }, [state.viewerLoading, state.viewerError])

  return createElement(
    UserContext.Provider,
    {
      value: {
        user: state.user,
        loading: state.loading,
        viewer: state.viewer,
        viewerLoading: state.viewerLoading,
        viewerError: state.viewerError,
        refreshViewer,
      },
    },
    children,
  )
}

export function useUser(): UseUserState {
  const state = useContext(UserContext)
  if (!state) throw new Error('useUser must be used within ViewerProvider')
  return state
}
