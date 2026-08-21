import { setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { localizePath } from '@/i18n/locale-preference'
import { resolveBrand } from '../_lib/resolve-brand'
import { requireUserPage } from '@/lib/auth/require-user'
import { routes } from '@/lib/routes'

type Props = {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ brand?: string }>
}

export default async function AnalyticsPage({ params, searchParams }: Props) {
  const { locale } = await params
  setRequestLocale(locale)
  const user = await requireUserPage(routes.dashboard.analytics(), locale)

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const selectedBrand = await resolveBrand(resolvedSearchParams, user.id, user.email)
  if (!selectedBrand) return null

  redirect(localizePath(routes.dashboard.brandSection(selectedBrand.brandSlug, 'analytics'), locale))
}
