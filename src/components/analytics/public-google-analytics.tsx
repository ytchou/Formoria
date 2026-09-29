'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Script from 'next/script'

import { isPublicAnalyticsPath } from '@/lib/analytics'
import {
  shouldSkipPageview,
  toAnalyticsPagePath,
  toAnalyticsQuery,
} from '@/lib/analytics/pageview-skip'
import { deferNoncritical } from '@/lib/browser/defer-noncritical'

interface PublicGoogleAnalyticsProps {
  gaId: string
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
  const lastSentPathRef = useRef<string | null>(null)
  const [loadScript, setLoadScript] = useState(false)
  const isPublicPath = isPublicAnalyticsPath(pathname)
  const pagePath = toAnalyticsPagePath(pathname, searchParams.toString())

  useEffect(() => {
    if (!isPublicPath || loadScript) return
    return deferNoncritical(() => setLoadScript(true))
  }, [isPublicPath, loadScript])

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

    // Page-view accounting, on scrubbed page paths (see pageview-skip.ts):
    // - The first page_view of a document always sends. DiscoverUrlSync renders
    //   before this component, so its effect may already have registered a rewrite.
    //   The skip check still runs for its side effect: the skip stays pending only
    //   while this path is the rewrite's `from` (the router has not yet reported the
    //   rewritten URL); a first path equal to `to` or unrelated clears it.
    // - A path equal to the last one sent or skipped is a no-op (dedupe): a URL change
    //   that only touches stripped params (q, infer, inferred) is not a new page.
    // - A path matching the pending rewrite target is skipped but remembered.
    const lastSentPath = lastSentPathRef.current
    if (lastSentPath !== null) {
      if (pagePath === lastSentPath) return
      if (shouldSkipPageview(pagePath)) {
        lastSentPathRef.current = pagePath
        return
      }
    } else {
      shouldSkipPageview(pagePath)
    }
    lastSentPathRef.current = pagePath

    window.gtag?.('event', 'page_view', {
      page_location: `${window.location.origin}${pagePath}`,
      page_path: pagePath,
      page_title: document.title,
      page_referrer: toAnalyticsReferrer(document.referrer),
    })
  }, [gaId, isPublicPath, pagePath])

  if (!isPublicPath || !loadScript) return null

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
