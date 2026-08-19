import type { Metadata } from 'next'
import Link from 'next/link'
import { BrandMark } from '@/lib/brand/BrandMark'
import { localizePath } from '@/i18n/locale-preference'

export const metadata: Metadata = {
  robots: { index: false, follow: true },
}

type LayoutProps = {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function AuthLayout({ children, params }: LayoutProps) {
  const { locale } = await params
  const homePath = localizePath('/', locale)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 items-center px-6">
        <Link href={homePath} className="flex items-center gap-2">
          <BrandMark size={28} />
          <span className="type-card-title">Formoria</span>
        </Link>
      </header>
      <main id="main-content" className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  )
}
