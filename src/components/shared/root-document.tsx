import { Suspense } from 'react'
import { Agentation } from 'agentation'
import { Bricolage_Grotesque, Geist_Mono, Inter, Noto_Sans_TC } from 'next/font/google'
import { Toaster } from 'sonner'
import { PublicGoogleAnalytics } from '@/components/analytics/public-google-analytics'
import { GaUserSync } from '@/components/analytics/ga-user-sync'
import { PostHogUserSync } from '@/components/analytics/posthog-user-sync'
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

const notoSansTC = Noto_Sans_TC({
  variable: '--font-noto-tc',
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  preload: false,
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
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
  return (
    <html
      lang={locale}
      className={`${inter.variable} ${bricolage.variable} ${notoSansTC.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:type-body-emphasis focus:shadow-lg focus:ring-2 focus:ring-ring"
        >
          {skipToContentLabel}
        </a>
        <ViewerProvider>
          <PostHogUserSync />
          <GaUserSync />
          {children}
          {process.env.NODE_ENV === 'development' && !process.env.PLAYWRIGHT_TEST && (
            <Agentation />
          )}
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
