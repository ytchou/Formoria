'use client'

import { useEffect, useState } from 'react'

import type { User } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/client'

type UseUserState = {
  user: User | null
  loading: boolean
}

export function useUser(): UseUserState {
  const [state, setState] = useState<UseUserState>({
    user: null,
    loading: true,
  })

  useEffect(() => {
    const supabase = createClient()
    let isMounted = true

    void (async () => {
      const { data, error } = await supabase.auth.getUser()

      if (!isMounted) {
        return
      }

      if (error) {
        setState({ user: null, loading: false })
        return
      }

      setState({ user: data.user ?? null, loading: false })
    })()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ user: session?.user ?? null, loading: false })
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  return state
}
