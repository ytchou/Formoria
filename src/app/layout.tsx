import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist_Mono, Inter } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Agentation } from "agentation";
import { unstable_cache } from "next/cache";
import { MainNav } from "@/components/navigation/main-nav";
import { Footer } from "@/components/navigation/footer";
import { SessionTracker } from "@/components/analytics/session-tracker";
import { getActiveCategories } from "@/lib/services/taxonomy";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-heading",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const getCachedCategories = unstable_cache(
  () => getActiveCategories(),
  ['active-categories'],
  { revalidate: 3600 }
)

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://formoria.com'),
  title: {
    default: 'Formoria 島藏 — 台灣製造品牌目錄',
    template: '%s | Formoria',
  },
  description: "台灣製造品牌目錄 — 探索精選台灣品牌",
  openGraph: {
    siteName: 'Formoria',
    locale: 'zh_TW',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const categories = await getCachedCategories()

  return (
    <html
      lang="zh-TW"
      className={`${inter.variable} ${bricolage.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SessionTracker />
        <MainNav categories={categories} />
        <div className="flex-1">{children}</div>
        <Footer />
        {process.env.NODE_ENV === "development" && <Agentation />}
        {process.env.NEXT_PUBLIC_GA_ID && (
          <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
        )}
      </body>
    </html>
  )
}
