import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist_Mono, Inter, Noto_Sans_TC, Noto_Serif_TC } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Agentation } from "agentation";
import { Toaster } from "sonner";
import { GaUserSync } from "@/components/analytics/ga-user-sync";
import { SessionTracker } from "@/components/analytics/session-tracker";
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

// Traditional Chinese fallback (Taiwan 教育部 glyphs). preload:false — the full CJK
// set is too large to preload; Latin renders via Inter/Bricolage first, CJK falls through.
const notoSansTC = Noto_Sans_TC({
  variable: "--font-noto-tc",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  preload: false,
});

const notoSerifTC = Noto_Serif_TC({
  variable: "--font-noto-serif-tc",
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  preload: false,
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: 'Formoria — 台灣製造品牌目錄',
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-TW"
      className={`${inter.variable} ${bricolage.variable} ${notoSansTC.variable} ${notoSerifTC.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SessionTracker />
        {children}
        {process.env.NODE_ENV === "development" && !process.env.PLAYWRIGHT_TEST && <Agentation />}
        {process.env.NEXT_PUBLIC_GA_ID && (
          <>
            <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
            <GaUserSync />
          </>
        )}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
