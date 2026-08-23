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
  /**
   * True when viewer context could not be fetched and the state below is the
   * fail-closed default rather than the server's answer. Without this, "resolved
   * and not an admin" and "never resolved" are the same observable state, which
   * is what made a swallowed failure here look like a slow render (DEV-1414).
   */
  viewerError: boolean
  refreshViewer: () => Promise<void>
}

const EMPTY_VIEWER_CONTEXT: ViewerContext = {
  // Fail closed: privileged surfaces stay hidden until the server says otherwise.
  isAdmin: false,
}

/**
 * De-duplication key for the signed-out viewer request. A user id is a UUID, so
 * this sentinel can never collide with an authenticated key.
 */
const ANONYMOUS_VIEWER_KEY = 'anonymous'

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
  /** The mount-time viewer fetch, awaiting adoption by the first signed-in resolution. */
  const speculativeViewerRef = useRef<Promise<ViewerContext> | null>(null)
  const userIdRef = useRef<string | null>(null)
  const [state, setState] = useState<Omit<UseUserState, 'refreshViewer'>>({
    user: null,
    loading: true,
    // Must start true: AdminAgentation reads `navigator` immediately after its
    // `viewerLoading` guard, and `navigator` is undefined during SSR.
    viewerLoading: true,
    viewer: EMPTY_VIEWER_CONTEXT,
    viewerError: false,
  })

  useEffect(() => {
    userIdRef.current = state.user?.id ?? null
  }, [state.user?.id])

  const refreshViewer = useCallback(async () => {
    // Compared against a ref rather than the closed-over render value: the
    // callback used to capture `state.user?.id` from the render it was created
    // in, so a refresh issued before auth had committed compared null against
    // the signed-in id and silently dropped its own result (DEV-1414).
    const userIdAtCall = userIdRef.current
    setState((current) => ({ ...current, viewerLoading: true }))
    let viewer = EMPTY_VIEWER_CONTEXT
    let viewerError = false
    try {
      viewer = await fetchViewerContextWithRetry()
    } catch (error) {
      // Viewer state controls privileged UI, so failures must resolve closed —
      // but they are now reported rather than swallowed.
      viewerError = true
      reportViewerFailure(error)
    }
    setState((current) =>
      (current.user?.id ?? null) === userIdAtCall
        ? { ...current, viewer, viewerLoading: false, viewerError }
        : current,
    )
  }, [])

  useEffect(() => {
    const supabase = createClient()
    let authEventVersion = 0
    let authRequestId = 0
    let active = true
    let viewerRequestId = 0
    let initialResolutionPending = true

    // Auth initialization and Supabase's INITIAL_SESSION event can overlap.
    // `viewerKey` is a user id, or ANONYMOUS_VIEWER_KEY for signed-out visitors —
    // both need viewer context, so both take part in the de-duplication.
    function loadViewerContext(
      viewerKey: string,
      allowSpeculative = false,
    ): Promise<ViewerContext> {
      const previousRequest = viewerRequestRef.current
      if (previousRequest?.viewerKey === viewerKey) {
        return previousRequest.promise
      }

      // The mount-time result is consumed exactly once, whether or not it is
      // used. Leaving it available for a later caller would mean a viewer
      // fetched *before* a sign-out could still be committed after it.
      const speculative = speculativeViewerRef.current
      speculativeViewerRef.current = null

      // Adopt only for a signed-in resolution. The speculative fetch reads the
      // same cookies this call would, so for an authenticated viewer a second
      // round trip is pure duplication — that overlap is the whole point. But on
      // the signed-out path the mount-time answer may pre-date the sign-out, and
      // committing a stale privileged result there is exactly the failure the
      // fail-closed reset exists to prevent.
      const request =
        allowSpeculative && speculative
          ? speculative
          : fetchViewerContextWithRetry()
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
      const isInitialResolution = initialResolutionPending
      initialResolutionPending = false
      if (!active) return

      // The anonymous branch fetches viewer context rather than settling on the
      // closed default. Privileged fields are reset to the closed default up
      // front so a sign-out cannot leave admin UI on screen while the anonymous
      // fetch is in flight.
      setState((current) =>
        user
          ? { ...current, user, loading: false, viewerLoading: true }
          : {
              user: null,
              loading: false,
              viewer: EMPTY_VIEWER_CONTEXT,
              viewerLoading: true,
              viewerError: false,
            },
      )

      let viewer = EMPTY_VIEWER_CONTEXT
      let viewerError = false
      try {
        // Adopt the mount-time fetch on the first resolution, or on any later
        // resolution that produced a signed-in user. The one case excluded is a
        // *sign-out* — there the mount-time answer may pre-date the sign-out,
        // and committing a stale privileged result is exactly what the
        // fail-closed reset above exists to prevent.
        viewer = await loadViewerContext(
          user?.id ?? ANONYMOUS_VIEWER_KEY,
          isInitialResolution || user !== null,
        )
      } catch (error) {
        // Viewer state controls privileged UI, so failures must resolve closed —
        // but they are now reported, and observable via `viewerError`.
        viewerError = true
        reportViewerFailure(error)
      }
      // Re-checked after the await, which now spans a retry: a longer in-flight
      // window is a longer window for a newer auth generation to supersede this
      // one, and a stale privileged result must never win.
      if (!active || requestId !== viewerRequestId) {
        return
      }
      setState({ user, loading: false, viewer, viewerLoading: false, viewerError })
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

    // Start the viewer fetch now, in parallel with the auth lookup below,
    // instead of chaining it behind one. Admin- and owner-gated controls used to
    // wait on the *sum* of two round trips — a client `getUser()` and a server
    // action that re-derives the user anyway — which under CI load pushed the
    // admin menu past a 15s wait and read as "element not found" (DEV-1414).
    //
    // This only primes the cache: `setAuthenticatedUser` adopts the in-flight
    // promise, so viewer state is still committed on the auth path. That keeps
    // the existing ordering guarantee that `viewer` never resolves ahead of
    // `user` — consumers that read both without a loading gate depend on it.
    speculativeViewerRef.current = fetchViewerContextWithRetry()
    speculativeViewerRef.current.catch(() => {
      // Whoever adopts this promise handles the failure; catching here only
      // prevents an unhandled rejection when nobody has adopted it yet.
    })

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
    { value: { ...state, refreshViewer } },
    children,
  )
}

export function useUser(): UseUserState {
  const state = useContext(UserContext)
  if (!state) throw new Error('useUser must be used within ViewerProvider')
  return state
}
