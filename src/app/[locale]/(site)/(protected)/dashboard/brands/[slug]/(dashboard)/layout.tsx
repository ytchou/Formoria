import type { ReactNode } from 'react'
import { setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { DashboardHeroCard } from '@/components/dashboard/dashboard-hero-card'
import { DashboardTabNav } from '@/components/dashboard/dashboard-tab-nav'
import { localizePath, signInHref } from '@/i18n/locale-preference'
import { requireBrandEditor } from '@/lib/auth/require-brand-editor'
import { computeProfileCompleteness } from '@/lib/services/profile-completeness'
import { toOwnerEditorContract } from '@/lib/services/brands'
import { routes } from '@/lib/routes'

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
        ? signInHref(routes.dashboard.brand(slug), locale)
        : localizePath(routes.dashboard.index(), locale),
    )
  }

  const brand = toOwnerEditorContract(editor.brand)
  const completeness = computeProfileCompleteness(brand)

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <DashboardHeroCard brand={brand} completeness={completeness} />
        <DashboardTabNav brandSlug={brand.slug} />
      </div>
      <main className="mx-auto max-w-7xl p-6 md:p-8">{children}</main>
    </div>
  )
}
