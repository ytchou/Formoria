import type { ReactNode } from 'react'
import { setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { DashboardMobileHeader } from '@/components/dashboard/dashboard-mobile-header'
import {
  DashboardSidebar,
  type DashboardSidebarProps,
} from '@/components/dashboard/dashboard-sidebar'
import { localizePath } from '@/i18n/locale-preference'
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
        ? '/auth/sign-in'
        : localizePath('/dashboard', locale),
    )
    return null
  }

  const completeness = computeProfileCompleteness(editor.brand)
  const sidebarProps = {
    brandName: editor.brand.name,
    brandNameEn: editor.brand.romanizedName ?? null,
    brandSlug: editor.brand.slug,
    brandLogoUrl: editor.brand.heroImageUrl,
    mitStatus: editor.brand.mitStatus ?? 'unverified',
    completenessScore: completeness.score,
    completenessTotal: completeness.total,
    completenessCompleted: completeness.completed,
  } satisfies Omit<DashboardSidebarProps, 'className'>

  return (
    <div className="flex min-h-screen">
      <DashboardSidebar {...sidebarProps} />
      <DashboardMobileHeader {...sidebarProps} />
      <main className="flex-1 overflow-y-auto p-6 md:p-8">{children}</main>
    </div>
  )
}
