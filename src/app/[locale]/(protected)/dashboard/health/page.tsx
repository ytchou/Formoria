import { setRequestLocale } from 'next-intl/server'
import { BrandHealthCard } from '@/components/dashboard/brand-health-card'
import { getAnalytics } from '@/lib/services/brand-analytics'
import { computeBrandCompleteness } from '@/lib/services/brand-completeness'
import { computeBrandHealth } from '@/lib/services/brand-health'
import { getBrandBySlug } from '@/lib/services/brands'
import { createClient } from '@/lib/supabase/server'
import { resolveBrand } from '../_lib/resolve-brand'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ brand?: string }>
}

export default async function HealthPage({ params, searchParams }: Props) {
  const { locale } = await params
  setRequestLocale(locale)

  const resolvedSearchParams = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const selectedBrand = await resolveBrand(resolvedSearchParams, user.id, user.email)
  if (!selectedBrand) return null

  const brand = await getBrandBySlug(selectedBrand.brandSlug)
  const analytics = await getAnalytics(brand.id, 30)
  const completeness = computeBrandCompleteness(brand)
  const health = computeBrandHealth(brand, analytics, new Date(brand.createdAt))

  return (
    <BrandHealthCard
      health={health}
      completeness={completeness}
      slug={brand.slug}
    />
  )
}
