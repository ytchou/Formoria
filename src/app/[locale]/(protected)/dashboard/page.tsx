import type { Metadata } from 'next'
import Image from 'next/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBrandBySlug } from '@/lib/services/brands'
import { resolveDashboardBrand } from '@/lib/services/resolve-dashboard-brand'
import { getSiteUrl } from '@/lib/site-url'
import { BadgeSection } from '@/components/dashboard/badge-section'
import { BrandAbout } from '@/components/brands/brand-about'
import { BrandCustomerVoices } from '@/components/brands/brand-customer-voices'
import { BrandHeader } from '@/components/brands/brand-header'
import { BrandLinks } from '@/components/brands/brand-links'
import { BrandLocations } from '@/components/brands/brand-locations'

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
  }
}

function Section({
  id,
  title,
  children,
}: {
  id?: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="font-heading text-base font-bold text-foreground">{title}</h2>
      {children}
    </section>
  )
}

function ProductPhotos({
  photos,
  brandName,
  title,
}: {
  photos: string[]
  brandName: string
  title: string
}) {
  if (photos.length === 0) return null

  return (
    <Section title={title}>
      <div
        aria-label={title}
        className="flex max-w-full gap-3 overflow-x-auto pb-2"
        role="region"
      >
        {photos.map((photo, index) => (
          <div
            key={`${photo}-${index}`}
            className="relative aspect-square w-44 shrink-0 overflow-hidden rounded-xl border border-border bg-muted"
          >
            <Image
              alt={`${brandName} product ${index + 1}`}
              className="object-cover"
              fill
              sizes="176px"
              src={photo}
            />
          </div>
        ))}
      </div>
    </Section>
  )
}

export default async function DashboardPage({ params, searchParams }: Props) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('dashboard.brandProfile')
  const tBadge = await getTranslations('dashboard.badge')
  const siteUrl = getSiteUrl()

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const ctx = user
    ? await resolveDashboardBrand(user.id, user.email ?? null, resolvedSearchParams.brand)
    : null

  if (!ctx) {
    return (
      <div className="rounded-xl border border-border bg-white p-10 text-center">
        <p className="text-sm font-normal text-muted-foreground">No brand profile found.</p>
      </div>
    )
  }

  const brand = await getBrandBySlug(ctx.brand.brandSlug)

  return (
    <div className="w-full space-y-8" data-testid="brand-profile">
      {brand.heroImageUrl ? (
        <div className="relative aspect-[7/2] w-full overflow-hidden rounded-xl bg-muted">
          <Image
            alt={brand.name}
            className="object-cover"
            fill
            priority
            sizes="(min-width: 1280px) 988px, 100vw"
            src={brand.heroImageUrl}
          />
        </div>
      ) : null}

      <div className="space-y-8">
        <BrandHeader brand={brand} categoryLabel={brand.category} />

        <BrandAbout brand={brand} />

        <BrandLinks brand={brand} />

        <BrandCustomerVoices brand={brand} />
        <ProductPhotos photos={brand.productPhotos} brandName={brand.name} title={t('productPhotos')} />
        <BrandLocations brand={brand} />

        {brand.status === 'approved' ? (
          <Section id="badge" title={tBadge('title')}>
            <BadgeSection
              brandSlug={brand.slug}
              brandUpdatedAt={brand.updatedAt}
              siteUrl={siteUrl}
              labels={{
                copy: tBadge('copy'),
                copied: tBadge('copied'),
                download: tBadge('download'),
              }}
            />
          </Section>
        ) : null}
      </div>
    </div>
  )
}
