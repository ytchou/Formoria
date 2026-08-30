import { Suspense } from 'react'
import { Toaster } from 'sonner'
import { PublicGoogleAnalytics } from '@/components/analytics/public-google-analytics'
import { GaUserSync } from '@/components/analytics/ga-user-sync'
import { PostHogUserSync } from '@/components/analytics/posthog-user-sync'
import { WebVitalsReporter } from '@/components/analytics/web-vitals-reporter'
import { AdminAgentation } from '@/components/shared/admin-agentation'
import { resolveGoogleAnalyticsId } from '@/lib/analytics/google-analytics-config'
import type { AppLocale } from '@/i18n/locale-preference'
import { ViewerProvider } from '@/lib/auth/use-user'

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
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-ground text-ink">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-control focus:bg-ground focus:px-4 focus:py-2 focus:type-body-sm focus:font-medium focus:border focus:border-rule focus:text-ink focus:ring-2 focus:ring-accent"
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
