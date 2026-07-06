import Image from 'next/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getBrandBySlug } from '@/lib/services/brands'
import { getAnalytics } from '@/lib/services/brand-analytics'
import { computeBrandHealth } from '@/lib/services/brand-health'
import { isOwnerOf } from '@/lib/services/brand-owners'
import { BrandAbout } from '@/components/brands/brand-about'
import { BrandCustomerVoices } from '@/components/brands/brand-customer-voices'
import { BrandHeader } from '@/components/brands/brand-header'
import { BrandLinks } from '@/components/brands/brand-links'
import { BrandLocations } from '@/components/brands/brand-locations'
import { HealthSummaryCard } from '@/components/dashboard/health-summary-card'
import { InlineVerification } from '@/components/dashboard/inline-verification'

type Props = {
  params: Promise<{ locale: string; slug: string }>
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

export default async function BrandOverviewPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const t = await getTranslations('dashboard.brandProfile')

  const brand = await getBrandBySlug(slug)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [analytics, ownerCheck] = await Promise.all([
    getAnalytics(brand.id, 30),
    user ? isOwnerOf(user.id, brand.id) : false,
  ])

  const health = computeBrandHealth(brand, analytics, new Date(brand.createdAt))

  return (
    <div className="w-full space-y-8" data-testid="brand-profile">
      <HealthSummaryCard health={health} slug={slug} />

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

        <InlineVerification
          brandId={brand.id}
          brandName={brand.name}
          brandSlug={brand.slug}
          mitStatus={brand.mitStatus ?? 'unverified'}
          mitEvidence={brand.mitEvidence ?? undefined}
          isOwner={ownerCheck}
        />

        <BrandAbout brand={brand} />

        <BrandLinks brand={brand} />

        <BrandCustomerVoices brand={brand} />
        <ProductPhotos photos={brand.productPhotos} brandName={brand.name} title={t('productPhotos')} />
        <BrandLocations brand={brand} />
      </div>
    </div>
  )
}
