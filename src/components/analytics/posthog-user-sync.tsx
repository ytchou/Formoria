'use client'

import { useEffect, useRef } from 'react'
import { isInternalUserEmail } from '@/lib/analytics/internal-users'
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
      identifyPostHogUser(nextUserId, {
        is_internal: isInternalUserEmail(user?.email),
      })
    }

    previousUserId.current = nextUserId
  }, [user])

  return null
}
