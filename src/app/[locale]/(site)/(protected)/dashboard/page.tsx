import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { localizePath } from '@/i18n/locale-preference'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { resolveDashboardBrand } from '@/lib/services/resolve-dashboard-brand'
import { requireUserPage } from '@/lib/auth/require-user'
import { routes } from '@/lib/routes'

type Props = {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ brand?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('dashboard')

  return {
    title: t('metadata.title'),
    robots: { index: false, follow: true },
  }
}

export default async function DashboardPage({ params, searchParams }: Props) {
  const { locale } = await params
  setRequestLocale(locale)
  const user = await requireUserPage(routes.dashboard.index(), locale)

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const ctx = await resolveDashboardBrand(
    user.id,
    user.email ?? null,
    resolvedSearchParams.brand,
  )

  if (!ctx) {
    return null
  }

  redirect(localizePath(routes.dashboard.brand(ctx.brand.brandSlug), locale))
}
