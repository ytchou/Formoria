'use client'

import { useEffect, useRef } from 'react'
import { isInternalUserEmail } from '@/lib/analytics/internal-users'
import {
  identifyPostHogUser,
  registerPostHogSuperProperties,
  resetPostHogUser,
} from '@/lib/analytics/posthog-provider'
import type { AppLocale } from '@/i18n/locale-preference'
import { useUser } from '@/lib/auth/use-user'

export function PostHogUserSync({ locale }: { locale: AppLocale }) {
  const { user } = useUser()
  const previousUserId = useRef<string | null>(null)

  // Kept separate from the identity effect below: the resolved route locale is
  // the authoritative attribution source and must not be tied to the `[user]`
  // dependency, which would delay or skip re-registration on locale switches.
  useEffect(() => {
    registerPostHogSuperProperties({ locale })
  }, [locale])

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
