import { Suspense } from 'react'
import { Bricolage_Grotesque, Geist_Mono, Inter } from 'next/font/google'
import { Toaster } from 'sonner'
import { PublicGoogleAnalytics } from '@/components/analytics/public-google-analytics'
import { GaUserSync } from '@/components/analytics/ga-user-sync'
import { PostHogUserSync } from '@/components/analytics/posthog-user-sync'
import { WebVitalsReporter } from '@/components/analytics/web-vitals-reporter'
import { AdminAgentation } from '@/components/shared/admin-agentation'
import type { AppLocale } from '@/i18n/locale-preference'
import { ViewerProvider } from '@/lib/auth/use-user'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

const bricolage = Bricolage_Grotesque({
  variable: '--font-bricolage',
  subsets: ['latin'],
})

// No webfont for Traditional Chinese: the CJK set is far too large to ship, so
// CJK deliberately falls through to the platform's own system face (PingFang TC,
// Microsoft JhengHei, Noto Sans CJK). Do not reintroduce a CJK webfont here.
// `preload: false` keeps this off the cold-visit critical path. Every public
// page preloaded it, but `font-mono` is only ever used behind admin, the
// dashboard, a chart tooltip and the share modal — never above the fold on `/`
// or `/brands`. It still loads normally once something actually renders with
// it (DEV-1336).
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  preload: false,
})

type RootDocumentProps = {
  children: React.ReactNode
  locale: AppLocale
  skipToContentLabel: string
  feedbackCopy: Record<string, string>
}

export function RootDocument({
  children,
  locale,
  skipToContentLabel,
  feedbackCopy,
}: RootDocumentProps) {
  return (
    <html
      lang={locale}
      data-feedback-copy={JSON.stringify(feedbackCopy)}
      className={`${inter.variable} ${bricolage.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:type-body-emphasis focus:shadow-lg focus:ring-2 focus:ring-ring"
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
          {process.env.NEXT_PUBLIC_GA_ID && (
            <Suspense fallback={null}>
              <PublicGoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
            </Suspense>
          )}
          <Toaster richColors position="top-right" />
        </ViewerProvider>
      </body>
    </html>
  )
}
