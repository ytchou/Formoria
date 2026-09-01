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
  getSavedProductIdsAction,
  toggleProductSaveAction,
} from '@/lib/actions/saved-products'
import { useUser } from '@/lib/auth/use-user'

type SavedProductsContextValue = {
  savedIds: Set<string>
  toggle: (productId: string) => void
  loading: boolean
}

const SavedProductsContext = createContext<SavedProductsContextValue | null>(null)

type SavedProductsProviderProps = {
  children: ReactNode
}

export function SavedProductsProvider({ children }: SavedProductsProviderProps) {
  const { user, loading: userLoading } = useUser()
  const userId = user?.id
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
      if (!userId) {
        if (isMounted) {
          setSavedIds(new Set())
          setFetchLoading(false)
        }
        return
      }

      setFetchLoading(true)

      try {
        const ids = await getSavedProductIdsAction()

        if (!isMounted) {
          return
        }

        setSavedIds(new Set(ids))
      } catch (error) {
        console.error('Failed to fetch saved products', error)
      } finally {
        if (isMounted) {
          setFetchLoading(false)
        }
      }
    })()

    return () => {
      isMounted = false
    }
  }, [userId, userLoading])

  const toggle = useCallback((productId: string) => {
    const snapshot = new Set(savedIds)

    setSavedIds((current) => {
      const next = new Set(current)

      if (next.has(productId)) {
        next.delete(productId)
      } else {
        next.add(productId)
      }

      return next
    })

    void (async () => {
      try {
        const result = await toggleProductSaveAction(productId)

        if ('error' in result) {
          setSavedIds(snapshot)
        }
      } catch (error) {
        console.error('Failed to toggle saved product', error)
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
    <SavedProductsContext.Provider value={value}>
      {children}
    </SavedProductsContext.Provider>
  )
}

export function useSavedProducts(): SavedProductsContextValue {
  const context = useContext(SavedProductsContext)

  if (context === null) {
    return {
      savedIds: new Set(),
      toggle: () => {},
      loading: false,
    }
  }

  return context
}
