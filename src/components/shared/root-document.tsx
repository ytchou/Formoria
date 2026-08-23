import { Suspense } from 'react'
import { Noto_Sans_TC, Noto_Serif_TC } from 'next/font/google'
import { Toaster } from 'sonner'
import { PublicGoogleAnalytics } from '@/components/analytics/public-google-analytics'
import { GaUserSync } from '@/components/analytics/ga-user-sync'
import { PostHogUserSync } from '@/components/analytics/posthog-user-sync'
import { WebVitalsReporter } from '@/components/analytics/web-vitals-reporter'
import { AdminAgentation } from '@/components/shared/admin-agentation'
import { resolveGoogleAnalyticsId } from '@/lib/analytics/google-analytics-config'
import type { AppLocale } from '@/i18n/locale-preference'
import { ViewerProvider } from '@/lib/auth/use-user'

/*
 * TWO CJK WEBFONTS, DELIBERATELY.
 *
 * This file used to say "Do not reintroduce a CJK webfont here" and shipped
 * three Latin-only faces instead, letting Traditional Chinese fall through to
 * whatever the platform happened to install. Design system v2 reverses that:
 * docs/decisions/2026-08-20-two-cjk-webfonts-supersede-the-system-face-rule.md
 * SUPERSEDES the old rule. Do not re-assert it from this comment's history.
 *
 * Two things make the reversal affordable, and both have to stay true:
 *
 *   1. Google splits both families by `unicode-range`, so a page transfers only
 *      the glyph blocks its own text actually uses. The payload is bounded by
 *      content, not by the size of the family. This is why NO `subsets` option
 *      is passed — naming a subset here is what broke the previous attempt
 *      (06f7e077 declared `subsets: ["latin"]`, so the font never served a
 *      single CJK glyph). Omitting it is only legal because preload is off.
 *   2. `next/font` self-hosts the files from our own origin, which satisfies
 *      the CSP `font-src 'self'` at next.config.ts:101. A CDN-hosted font is
 *      blocked at runtime, not at build — the failure would ship.
 *
 * `preload: false` on both keeps a CJK subset off the cold-visit critical path;
 * that is the DEV-1336 regression, and it applies harder to CJK than it did to
 * Geist Mono. `display: 'swap'` renders the system face immediately and repaints
 * once the webfont arrives, so text is never invisible while it loads.
 */

// Ming (Traditional Chinese serif) — content: prose, titles, story and brand
// copy. Bound to `--font-ming` in globals.css.
const notoSerifTC = Noto_Serif_TC({
  variable: '--font-noto-serif-tc',
  display: 'swap',
  preload: false,
})

// Hei (Traditional Chinese sans) — interface: navigation, controls, metadata,
// admin and dashboard chrome. Bound to `--font-hei` in globals.css.
const notoSansTC = Noto_Sans_TC({
  variable: '--font-noto-sans-tc',
  display: 'swap',
  preload: false,
})

type RootDocumentProps = {
  children: React.ReactNode
  locale: AppLocale
  skipToContentLabel: string
}

export function RootDocument({
  children,
  locale,
  skipToContentLabel,
}: RootDocumentProps) {
  // Gated on the deployment environment, not merely on the ID being present:
  // staging and local production builds carry the same measurement ID, and GA4
  // has no practical way to delete their sessions after the fact.
  const gaId = resolveGoogleAnalyticsId()

  return (
    <html
      lang={locale}
      className={`${notoSerifTC.variable} ${notoSansTC.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-ground text-ink">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-control focus:bg-background focus:px-4 focus:py-2 focus:type-body-sm focus:font-medium focus:text-ink focus:shadow-lg focus:ring-2 focus:ring-ring"
        >
          {skipToContentLabel}
        </a>
        <ViewerProvider>
          <PostHogUserSync locale={locale} />
          <GaUserSync />
          <WebVitalsReporter />
          {children}
          {/* Admin-only, all environments. Gating (including the Playwright
              suppression) lives inside the component — a server-side env read
              here would be frozen at build time on every prerendered page. */}
          <AdminAgentation />
          {gaId && (
            <Suspense fallback={null}>
              <PublicGoogleAnalytics gaId={gaId} />
            </Suspense>
          )}
          <Toaster richColors position="top-right" />
        </ViewerProvider>
      </body>
    </html>
  )
}
