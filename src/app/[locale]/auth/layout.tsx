import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '@/components/ui/page-shell'
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
    <div className="flex min-h-screen flex-col bg-ground">
      {/* The site header's first row, wordmark only: same shell, same height
          token and same wordmark as `main-nav.tsx`, so the wordmark sits on
          the same left edge as on every other route. */}
      <PageShell
        as="header"
        measure="page"
        className="flex h-(--nav-row-primary) items-center"
      >
        <Link
          href={homePath}
          className="inline-flex min-h-11 shrink-0 items-center type-card-title"
        >
          Formoria
        </Link>
      </PageShell>
      <main
        id="main-content"
        className="page-gutter flex flex-1 items-center justify-center"
      >
        <div className="content-column w-full">{children}</div>
      </main>
    </div>
  )
}
