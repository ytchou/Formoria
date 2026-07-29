import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { createClient } from '@/lib/supabase/server'
import { isOwnerFeaturesEnabled } from '@/lib/services/app-settings'
import { resolveDashboardBrand } from '@/lib/services/resolve-dashboard-brand'
import { DashboardEmptyState } from '@/components/dashboard/dashboard-empty-state'

type DashboardLayoutProps = {
  children: ReactNode
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ brand?: string }>
}

export default async function DashboardLayout({
  children,
  params,
  searchParams,
}: DashboardLayoutProps) {
  const { locale } = await params
  setRequestLocale(locale)

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  // Owner features kill switch. Admins keep access so impersonation /
  // view-as-owner QA still works while the flag is off.
  const ownerFeaturesEnabled = await isOwnerFeaturesEnabled()
  if (!ownerFeaturesEnabled && !(await isActingAsAdmin(user.email))) {
    notFound()
  }

  const ctx = await resolveDashboardBrand(
    user.id,
    user.email ?? null,
    resolvedSearchParams.brand,
  )

  if (!ctx) {
    return <DashboardEmptyState />
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="page-gutter mx-auto max-w-screen-xl py-8">
        <div className="space-y-6">{children}</div>
      </main>
    </div>
  )
}
