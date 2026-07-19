'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Script from 'next/script'

import { isPublicAnalyticsPath } from '@/lib/analytics'
import { GaUserSync } from './ga-user-sync'

interface PublicGoogleAnalyticsProps {
  gaId: string
}

export function PublicGoogleAnalytics({ gaId }: PublicGoogleAnalyticsProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initializedRef = useRef(false)
  const isPublicPath = isPublicAnalyticsPath(pathname)
  const query = searchParams.toString()

  useEffect(() => {
    if (!isPublicPath) return

    window.dataLayer = window.dataLayer ?? []
    window.gtag =
      window.gtag ??
      function gtag(...args: unknown[]) {
        window.dataLayer?.push(args as never)
      }

    if (!initializedRef.current) {
      window.gtag('js', new Date())
      window.gtag('config', gaId, { send_page_view: false })
      initializedRef.current = true
    }

    const pagePath = query ? `${pathname}?${query}` : pathname
    window.gtag?.('event', 'page_view', {
      page_location: `${window.location.origin}${pagePath}`,
      page_path: pagePath,
      page_title: document.title,
    })
  }, [gaId, isPublicPath, pathname, query])

  if (!isPublicPath) return null

  return (
    <>
      <Script
        id="formoria-ga-script"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`}
        strategy="afterInteractive"
      />
      <GaUserSync />
    </>
  )
}
