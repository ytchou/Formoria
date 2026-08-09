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
      // Both keys, deliberately. `is_internal` is ours and all historical data carries it;
      // `$internal_or_test_user` is the key PostHog's own "filter out internal and test
      // users" setting reads, and setting only the former is why that setting excluded
      // nobody for the project's first three weeks (DEV-1408).
      const internal = isInternalUserEmail(user?.email)
      identifyPostHogUser(nextUserId, {
        is_internal: internal,
        $internal_or_test_user: internal,
      })
    }

    previousUserId.current = nextUserId
  }, [user])

  return null
}
