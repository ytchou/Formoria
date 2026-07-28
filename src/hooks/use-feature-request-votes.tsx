'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  getMyVotedRequestIdsAction,
  setFeatureRequestVoteAction,
} from '@/lib/actions/feature-requests'
import type { SetFeatureRequestVoteActionResult } from '@/lib/actions/feature-requests-core'
import { useUser } from '@/lib/auth/use-user'

type FeatureRequestVotesContextValue = {
  votedIds: Set<string>
  loading: boolean
  /**
   * Applies a vote and returns the raw action result so the caller can
   * reconcile its own count. The membership Set is flipped optimistically here
   * and rolled back here — the caller never has to know how to undo it.
   */
  vote: (
    requestId: string,
    voted: boolean,
  ) => Promise<SetFeatureRequestVoteActionResult>
}

const FeatureRequestVotesContext =
  createContext<FeatureRequestVotesContextValue | null>(null)

function applyMembership(
  current: Set<string>,
  requestId: string,
  voted: boolean,
): Set<string> {
  const next = new Set(current)
  if (voted) next.add(requestId)
  else next.delete(requestId)
  return next
}

/**
 * Owns "which requests has this viewer already voted for" for a whole board.
 *
 * The single `getMyVotedRequestIdsAction()` call lives here rather than in the
 * row, so a 200-row board costs one round trip instead of 200.
 */
export function FeatureRequestVotesProvider({
  children,
}: {
  children: ReactNode
}) {
  const { user, loading: userLoading } = useUser()
  const userId = user?.id
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set())
  const [fetchLoading, setFetchLoading] = useState(false)

  useEffect(() => {
    let isMounted = true

    if (userLoading) {
      return () => {
        isMounted = false
      }
    }

    void (async () => {
      if (!userId) {
        if (isMounted) {
          setVotedIds(new Set())
          setFetchLoading(false)
        }
        return
      }

      setFetchLoading(true)

      try {
        const result = await getMyVotedRequestIdsAction()
        if (!isMounted) return
        if (result.ok) setVotedIds(new Set(result.requestIds))
      } catch (error) {
        console.error('Failed to fetch feature request votes', error)
      } finally {
        if (isMounted) setFetchLoading(false)
      }
    })()

    return () => {
      isMounted = false
    }
  }, [userId, userLoading])

  const vote = useCallback(
    async (
      requestId: string,
      voted: boolean,
    ): Promise<SetFeatureRequestVoteActionResult> => {
      setVotedIds((current) => applyMembership(current, requestId, voted))
      // Rolling back one membership rather than restoring a whole snapshot:
      // two rows can be in flight at once, and a snapshot restore would undo
      // the other row's vote as collateral.
      const rollback = () =>
        setVotedIds((current) => applyMembership(current, requestId, !voted))

      try {
        const result = await setFeatureRequestVoteAction({ requestId, voted })
        if (result.ok) {
          setVotedIds((current) =>
            applyMembership(current, requestId, result.voted),
          )
        } else {
          rollback()
        }
        return result
      } catch (error) {
        rollback()
        throw error
      }
    },
    [],
  )

  const value = useMemo(
    () => ({ votedIds, loading: userLoading || fetchLoading, vote }),
    [fetchLoading, userLoading, vote, votedIds],
  )

  return (
    <FeatureRequestVotesContext.Provider value={value}>
      {children}
    </FeatureRequestVotesContext.Provider>
  )
}

/**
 * Outside a provider the control still works — it just has no memory of prior
 * votes, so it renders unpressed. That keeps a stray upvote button from
 * throwing the way `useUser` does.
 */
export function useFeatureRequestVotes(): FeatureRequestVotesContextValue {
  const context = useContext(FeatureRequestVotesContext)

  if (context === null) {
    return {
      votedIds: new Set(),
      loading: false,
      vote: (requestId, voted) =>
        setFeatureRequestVoteAction({ requestId, voted }),
    }
  }

  return context
}
