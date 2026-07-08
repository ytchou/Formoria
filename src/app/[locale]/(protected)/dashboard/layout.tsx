import type { ReactNode } from 'react'
import { setRequestLocale } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
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
      <main className="mx-auto max-w-screen-xl px-6 py-8">
        <div className="space-y-6">{children}</div>
      </main>
    </div>
  )
}
