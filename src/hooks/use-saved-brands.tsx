'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import {
  getSavedBrandIdsAction,
  toggleSaveAction,
} from '@/lib/actions/saved-brands'
import { useUser } from '@/lib/auth/use-user'

type SavedBrandsContextValue = {
  savedIds: Set<string>
  toggle: (brandId: string) => void
  loading: boolean
}

const SavedBrandsContext = createContext<SavedBrandsContextValue | null>(null)

type SavedBrandsProviderProps = {
  children: ReactNode
}

export function SavedBrandsProvider({ children }: SavedBrandsProviderProps) {
  const t = useTranslations('saveBrand')
  const { user, loading: userLoading } = useUser()
  const userId = user?.id
  const activeUserId = useRef(userId)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [fetchLoading, setFetchLoading] = useState(false)

  useEffect(() => {
    let isMounted = true
    activeUserId.current = userLoading ? undefined : userId

    if (userLoading) {
      return () => {
        isMounted = false
      }
    }

    void (async () => {
      if (!userId) {
        if (isMounted) {
          setSavedIds(new Set())
          setFetchLoading(false)
        }
        return
      }

      setFetchLoading(true)

      try {
        const ids = await getSavedBrandIdsAction()

        if (!isMounted) {
          return
        }

        setSavedIds(new Set(ids))
      } catch (error) {
        console.error('Failed to fetch saved brands', error)
      } finally {
        if (isMounted) {
          setFetchLoading(false)
        }
      }
    })()

    return () => {
      isMounted = false
      activeUserId.current = undefined
    }
  }, [userId, userLoading])

  const toggle = useCallback((brandId: string) => {
    if (!userId || userLoading) return
    const wasSaved = savedIds.has(brandId)
    const isCurrentUser = () => activeUserId.current === userId

    function reconcile(saved: boolean) {
      if (!isCurrentUser()) return
      setSavedIds((current) => {
        if (!isCurrentUser()) return current
        const next = new Set(current)
        if (saved) next.add(brandId)
        else next.delete(brandId)
        return next
      })
    }

    async function recover() {
      if (!isCurrentUser()) return
      toast.error(t('errorToast'))
      try {
        // Other optimistic saves stay intact; this brand needs its persisted
        // value because an earlier overlapping toggle may also have failed.
        const confirmedIds = await getSavedBrandIdsAction()
        reconcile(confirmedIds.includes(brandId))
      } catch (error) {
        console.error('Failed to recover saved brand state', error)
        reconcile(wasSaved)
      }
    }

    setSavedIds((current) => {
      const next = new Set(current)

      if (next.has(brandId)) {
        next.delete(brandId)
      } else {
        next.add(brandId)
      }

      return next
    })

    void (async () => {
      try {
        const result = await toggleSaveAction(brandId)

        if ('error' in result) {
          await recover()
        } else {
          reconcile(result.saved)
        }
      } catch (error) {
        console.error('Failed to toggle saved brand', error)
        await recover()
      }
    })()
  }, [savedIds, t, userId, userLoading])

  const value = useMemo(
    () => ({
      savedIds,
      toggle,
      loading: userLoading || fetchLoading,
    }),
    [fetchLoading, savedIds, toggle, userLoading]
  )

  return (
    <SavedBrandsContext.Provider value={value}>
      {children}
    </SavedBrandsContext.Provider>
  )
}

export function useSavedBrands(): SavedBrandsContextValue {
  const context = useContext(SavedBrandsContext)

  if (context === null) {
    return {
      savedIds: new Set(),
      toggle: () => {},
      loading: false,
    }
  }

  return context
}
