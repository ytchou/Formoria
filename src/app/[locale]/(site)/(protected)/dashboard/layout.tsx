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
}

export default async function DashboardLayout({
  children,
  params,
}: DashboardLayoutProps) {
  const { locale } = await params
  setRequestLocale(locale)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // A layout has no pathname, so it cannot build `next` itself. Pass through
  // instead of returning null: the nested page guards (requireUserPage /
  // requireBrandEditor) redirect to a sign-in URL that preserves the
  // destination. Returning null here would blank the page and strand the user.
  if (!user) return <>{children}</>

  // Owner features kill switch. Admins keep access so impersonation /
  // view-as-owner QA still works while the flag is off.
  const ownerFeaturesEnabled = await isOwnerFeaturesEnabled()
  if (!ownerFeaturesEnabled && !(await isActingAsAdmin(user.email))) {
    notFound()
  }

  const ctx = await resolveDashboardBrand(user.id, user.email ?? null)

  if (!ctx) {
    return <DashboardEmptyState />
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="page-gutter mx-auto page-measure py-8">
        <div className="space-y-6">{children}</div>
      </main>
    </div>
  )
}
