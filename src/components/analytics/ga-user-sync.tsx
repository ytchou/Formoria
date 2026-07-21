'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

import {
  getContentGroup,
  getUtmParams,
  isPublicAnalyticsPath,
  persistUtmTouchPoints,
  trackLogin,
  trackSignUp,
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
  const utmInitializedRef = useRef(false)

  useEffect(() => {
    const userType = user ? 'authenticated' : 'visitor'
    const previousUserWasNull = previousUserWasNullRef.current

    if (previousUserWasNull === true && user) {
      const params = new URLSearchParams(window.location.search)
      const isNewUser = params.get('is_new_user') === '1'
      const method = user.provider

      if (isNewUser) {
        trackSignUp(method)
        params.delete('is_new_user')
        window.history.replaceState(
          {},
          '',
          params.toString()
            ? `${window.location.pathname}?${params.toString()}`
            : window.location.pathname,
        )
      } else {
        trackLogin(method)
      }
    }

    previousUserWasNullRef.current = user === null

    if (isPublicAnalyticsPath(pathname)) {
      safeGtag('set', { user_id: user?.id ?? null })
      safeGtag('set', {
        user_properties: {
          user_type: userType,
          preferred_locale: getPreferredLocale(pathname),
        },
      })
    }
  }, [pathname, user])

  useEffect(() => {
    if (!isPublicAnalyticsPath(pathname)) return
    safeGtag('set', { content_group: getContentGroup(pathname) })
  }, [pathname])

  useEffect(() => {
    if (!isPublicAnalyticsPath(pathname)) {
      utmInitializedRef.current = false
      return
    }
    if (utmInitializedRef.current) return
    utmInitializedRef.current = true
    const utmParams = getUtmParams(window.location.search)
    if (Object.keys(utmParams).length === 0) return

    const touchPoints = persistUtmTouchPoints(utmParams)
    if (!touchPoints) return

    safeGtag('set', { user_properties: { ...touchPoints } })
  }, [pathname])

  return null
}
