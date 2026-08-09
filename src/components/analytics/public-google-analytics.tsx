'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Script from 'next/script'

import { isPublicAnalyticsPath } from '@/lib/analytics'

interface PublicGoogleAnalyticsProps {
  gaId: string
}

// Params carrying raw user-typed text. Search terms ARE captured deliberately as of
// DEV-1408 — but only as the `search_term` property on PostHog's search events, where the
// value is guarded and truncated at the call site. A query smuggled through a URL gets none
// of that: GA derives `dl`/`dr` from whatever we hand it, so these must still be stripped
// before they reach `page_location`/`page_referrer`. Filter/sort/page params are
// deliberately kept: they are a closed vocabulary and carry no user text.
const FREE_TEXT_PARAMS = ['search']

function toAnalyticsQuery(search: string): string {
  const params = new URLSearchParams(search)
  for (const key of FREE_TEXT_PARAMS) params.delete(key)
  return params.toString()
}

// Referrer leaks the previous page's query string, so it needs the same scrubbing.
// Returns undefined for an absent referrer rather than synthesizing one.
function toAnalyticsReferrer(referrer: string): string | undefined {
  if (!referrer) return undefined
  try {
    const url = new URL(referrer)
    url.search = toAnalyticsQuery(url.search)
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

export function PublicGoogleAnalytics({ gaId }: PublicGoogleAnalyticsProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initializedRef = useRef(false)
  const isPublicPath = isPublicAnalyticsPath(pathname)
  const query = toAnalyticsQuery(searchParams.toString())

  useEffect(() => {
    if (!isPublicPath) return

    window.dataLayer = window.dataLayer ?? []
    window.gtag =
      window.gtag ??
      function gtag() {
        // gtag.js executes commands only when given an `arguments` object —
        // a plain array pushed to dataLayer is silently ignored (no hits sent)
        // eslint-disable-next-line prefer-rest-params
        window.dataLayer?.push(arguments as never)
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
      page_referrer: toAnalyticsReferrer(document.referrer),
    })
  }, [gaId, isPublicPath, pathname, query])

  if (!isPublicPath) return null

  return (
    <>
      <Script
        id="formoria-ga-script"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`}
        strategy="lazyOnload"
      />
    </>
  )
}
