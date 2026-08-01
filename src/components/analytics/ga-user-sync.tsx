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
  const utmInitializedRef = useRef(false)

  useEffect(() => {
    const userType = user ? 'authenticated' : 'visitor'

    // The post-auth redirect stamps the URL with the auth event that just
    // happened. A client-side null -> user transition cannot be used here: the
    // viewer resolves asynchronously, so every full page load looks like one.
    // `user` is needed for the method, so wait for it before firing; the marker
    // survives in the URL until then and a later run picks it up.
    if (user) {
      const params = new URLSearchParams(window.location.search)
      const isNewUser = params.get('is_new_user') === '1'
      const isLogin = params.get('auth_event') === 'login'

      if (isNewUser || isLogin) {
        if (isNewUser) {
          trackSignUp(user.provider)
          params.delete('is_new_user')
        } else {
          trackLogin(user.provider)
          params.delete('auth_event')
        }
        // Stripping in the same run is what stops a re-render or a strict-mode
        // double invoke from firing the event twice.
        window.history.replaceState(
          {},
          '',
          params.toString()
            ? `${window.location.pathname}?${params.toString()}`
            : window.location.pathname,
        )
      }
    }

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
