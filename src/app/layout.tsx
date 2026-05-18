import type { Metadata } from 'next'
import { Bricolage_Grotesque, Inter } from 'next/font/google'
import { Geist_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
})

const bricolageGrotesque = Bricolage_Grotesque({
  variable: '--font-heading',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'MIT Map — Made in Taiwan Brand Directory',
  description: '台灣製造品牌目錄 — Discover thoughtfully curated Taiwanese brands',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-TW"
      className={`${inter.variable} ${bricolageGrotesque.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  )
}
