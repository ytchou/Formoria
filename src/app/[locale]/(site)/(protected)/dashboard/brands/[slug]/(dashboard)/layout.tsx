import type { ReactNode } from 'react'
import { setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { DashboardHeroCard } from '@/components/dashboard/dashboard-hero-card'
import { DashboardTabNav } from '@/components/dashboard/dashboard-tab-nav'
import { localizePath, signInHref } from '@/i18n/locale-preference'
import { requireBrandEditor } from '@/lib/auth/require-brand-editor'
import { computeProfileCompleteness } from '@/lib/services/profile-completeness'

type DashboardBrandLayoutProps = {
  children: ReactNode
  params: Promise<{ locale: string; slug: string }>
}

export default async function DashboardBrandLayout({
  children,
  params,
}: DashboardBrandLayoutProps) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const editor = await requireBrandEditor(slug, { includeRomanizedName: true })
  if ('error' in editor) {
    redirect(
      editor.error === 'notLoggedIn'
        ? signInHref(`/dashboard/brands/${slug}`, locale)
        : localizePath('/dashboard', locale),
    )
  }

  const completeness = computeProfileCompleteness(editor.brand)

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <DashboardHeroCard brand={editor.brand} completeness={completeness} />
        <DashboardTabNav brandSlug={editor.brand.slug} />
      </div>
      <main className="mx-auto max-w-7xl p-6 md:p-8">{children}</main>
    </div>
  )
}
