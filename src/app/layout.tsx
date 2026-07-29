import { Suspense } from "react";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist_Mono, Inter } from "next/font/google";
import { Agentation } from "agentation";
import { Toaster } from "sonner";
import { PublicGoogleAnalytics } from "@/components/analytics/public-google-analytics";
import { GaUserSync } from "@/components/analytics/ga-user-sync";
import { PostHogUserSync } from "@/components/analytics/posthog-user-sync";
import { WebVitalsReporter } from "@/components/analytics/web-vitals-reporter";
import { ViewerProvider } from "@/lib/auth/use-user";
import { getSiteUrl } from "@/lib/seo/site-url";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

// No webfont for Traditional Chinese: the CJK set is far too large to ship, so
// CJK deliberately falls through to the platform's own system face (PingFang TC,
// Microsoft JhengHei, Noto Sans CJK). Do not reintroduce a CJK webfont here.
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: 'Formoria — 台灣品牌目錄',
    template: '%s | Formoria',
  },
  description: "台灣品牌目錄 — 探索精選台灣品牌",
  openGraph: {
    siteName: 'Formoria',
    locale: 'zh_TW',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-TW"
      className={`${inter.variable} ${bricolage.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a
          href="#main-content"
          lang="en"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:type-body-emphasis focus:shadow-lg focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <ViewerProvider>
          <PostHogUserSync />
          <GaUserSync />
          <WebVitalsReporter />
          {children}
          {process.env.NODE_ENV === "development" && !process.env.PLAYWRIGHT_TEST && <Agentation />}
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
