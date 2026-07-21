'use client'

import { useEffect, useRef } from 'react'
import {
  identifyPostHogUser,
  resetPostHogUser,
} from '@/lib/analytics/posthog-provider'
import { useUser } from '@/lib/auth/use-user'

export function PostHogUserSync() {
  const { user } = useUser()
  const previousUserId = useRef<string | null>(null)

  useEffect(() => {
    const nextUserId = user?.id ?? null

    if (previousUserId.current && previousUserId.current !== nextUserId) {
      resetPostHogUser()
    }
    if (nextUserId && previousUserId.current !== nextUserId) {
      identifyPostHogUser(nextUserId)
    }

    previousUserId.current = nextUserId
  }, [user])

  return null
}
