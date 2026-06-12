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
  const { user, loading: userLoading } = useUser()
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [fetchLoading, setFetchLoading] = useState(false)

  useEffect(() => {
    let isMounted = true

    if (userLoading) {
      return () => {
        isMounted = false
      }
    }

    void (async () => {
      if (!user) {
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
    }
  }, [user, userLoading])

  const toggle = useCallback((brandId: string) => {
    const snapshot = new Set(savedIds)

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
          setSavedIds(snapshot)
        }
      } catch (error) {
        console.error('Failed to toggle saved brand', error)
        setSavedIds(snapshot)
      }
    })()
  }, [savedIds])

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
