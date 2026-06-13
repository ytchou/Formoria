'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

import {
  getContentGroup,
  getUtmParams,
  persistUtmTouchPoints,
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

  useEffect(() => {
    const userType = user ? 'authenticated' : 'visitor'

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
