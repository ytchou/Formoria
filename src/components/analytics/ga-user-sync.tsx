'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

import {
  getContentGroup,
  getUtmParams,
  persistUtmTouchPoints,
  trackLogin,
} from '@/lib/analytics'
import { useUser } from '@/lib/auth/use-user'

type GtagSetArgs = ['set', Record<string, unknown>]

function safeGtag(...args: GtagSetArgs) {
  try {
    window.gtag?.(...args)
  } catch {
    // Analytics should never affect app behavior.
  }
}

function getPreferredLocale(pathname: string): string | null {
  const locale = pathname.split('/').filter(Boolean)[0]
  return locale === 'zh-TW' || locale === 'en' ? locale : null
}

export function GaUserSync() {
  const { user } = useUser()
  const pathname = usePathname()
  const previousUserWasNullRef = useRef<boolean | null>(null)

  useEffect(() => {
    const userType = user ? 'authenticated' : 'visitor'
    const previousUserWasNull = previousUserWasNullRef.current

    if (previousUserWasNull === true && user) {
      // We cannot reliably distinguish sign_up from login on the client side with Supabase useUser.
      // sign_up should ideally fire from the auth callback route where Supabase provides is_new_user — out of scope for this fix.
      trackLogin('google')
    }

    previousUserWasNullRef.current = user === null

    safeGtag('set', { user_id: user?.id ?? null })
    safeGtag('set', {
      user_properties: {
        user_type: userType,
        preferred_locale: getPreferredLocale(pathname),
      },
    })
  }, [pathname, user])

  useEffect(() => {
    safeGtag('set', { content_group: getContentGroup(pathname) })
  }, [pathname])

  useEffect(() => {
    const utmParams = getUtmParams(window.location.search)
    if (Object.keys(utmParams).length === 0) return

    const touchPoints = persistUtmTouchPoints(utmParams)
    if (!touchPoints) return

    safeGtag('set', { user_properties: { ...touchPoints } })
  }, [])

  return null
}
