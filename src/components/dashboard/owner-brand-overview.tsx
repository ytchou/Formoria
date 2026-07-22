import Image from 'next/image'
import { getLocale, getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { InfoField, InfoGroup, SurfaceCard } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import { getProductTypeLabel } from '@/lib/brands/category-label'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import {
  isConfirmedRetailLocation,
  isRetailChainChannel,
  isUnconfirmedRetailLocation,
  normalizeRetailLocations,
} from '@/lib/brands/locations'
import type { Brand } from '@/lib/types'
import type { RetailLocationRelationshipType } from '@/lib/types/brand'

type OwnerSectionProps = {
  children: React.ReactNode
  description: string
  editHref?: string
  title: string
  editLabel?: string
  prominentEdit?: boolean
}

function OwnerSection({
  children,
  description,
  editHref,
  title,
  editLabel,
  prominentEdit = false,
}: OwnerSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="type-section-title">{title}</h2>
          <p className="type-section-description">{description}</p>
        </div>
        {editHref && editLabel ? (
          <Link
            aria-label={`${editLabel}: ${title}`}
            className={
              prominentEdit
                ? buttonVariants({
                    variant: 'secondary',
                    size: 'large',
                    className: 'min-h-12',
                  })
                : 'type-link'
            }
            href={editHref}
          >
            {editLabel}
          </Link>
        ) : null}
      </div>
      <SurfaceCard>{children}</SurfaceCard>
    </section>
  )
}

function EmptyValue({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

function display(value: string | number | null | undefined, fallback: string) {
  return value === null || value === undefined || value === ''
    ? <EmptyValue>{fallback}</EmptyValue>
    : String(value)
}

function locationTypeLabelKey(type: RetailLocationRelationshipType) {
  switch (type) {
    case 'brand_store':
      return 'locationTypeBrandStore'
    case 'department_counter':
      return 'locationTypeDepartmentCounter'
    case 'stockist':
      return 'locationTypeStockist'
  }
}

export async function OwnerBrandOverview({
  brand,
  verification,
}: {
  brand: Brand
  verification?: React.ReactNode
}) {
  const [locale, t, tEdit] = await Promise.all([
    getLocale(),
    getTranslations('dashboard.brandProfile'),
    getTranslations('dashboard.edit'),
  ])
  const editBase = `/dashboard/brands/${brand.slug}/edit?step=`
  const retailLocations = normalizeRetailLocations(brand.retailLocations)
  const heroImageUrl = safeImageSrc(brand.heroImageUrl)
  const productPhotos = brand.productPhotos
    .map((photo) => safeImageSrc(photo))
    .filter((photo): photo is string => photo !== null)
  const priceRange = brand.priceRange
    ? tEdit(
        brand.priceRange === 1
          ? 'fieldPriceRangeBudget'
          : brand.priceRange === 2
            ? 'fieldPriceRangeMidRange'
            : 'fieldPriceRangePremium',
      )
    : <EmptyValue>{t('notSet')}</EmptyValue>

  return (
    <div className="space-y-8">
      <OwnerSection description={t('sectionBasicInfoHint')} editHref={`${editBase}0`} title={tEdit('wizardStepBasicInfo')} editLabel={t('edit')}>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <InfoField label={tEdit('fieldBrandName')} value={display(brand.name, t('notSet'))} />
          <InfoField
            label={tEdit('fieldProductType')}
            value={brand.productType
              ? (getProductTypeLabel(brand.productType, locale === 'zh-TW' ? 'zh-TW' : 'en') ?? brand.productType)
              : <EmptyValue>{t('notSet')}</EmptyValue>}
          />
          <InfoField label={tEdit('fieldDescription')} value={display(brand.description, t('notSet'))} wide />
          <InfoField label={tEdit('fieldFoundingYear')} value={display(brand.foundingYear, t('notSet'))} />
          <InfoField label={tEdit('city')} value={display(brand.city, t('notSet'))} />
          <InfoField label={tEdit('fieldPriceRange')} value={priceRange} />
          <InfoField
            label={tEdit('fieldProductTags')}
            value={brand.productTags.length > 0 ? brand.productTags.join(' · ') : <EmptyValue>{t('notSet')}</EmptyValue>}
          />
          <InfoField label={tEdit('mitStoryLabel')} value={display(brand.mitStory, t('notSet'))} wide />
        </dl>
      </OwnerSection>

      <OwnerSection description={t('sectionBrandImagesHint')} editHref={`${editBase}1`} title={tEdit('wizardStepMedia')} editLabel={t('edit')}>
        <div className="space-y-6">
          <InfoGroup
            description={tEdit('heroImageOverviewHint')}
            label={tEdit('fieldHeroImage')}
          >
            {heroImageUrl ? (
              <div className="relative aspect-[16/9] max-w-md overflow-hidden rounded-xl bg-muted">
                <Image alt={tEdit('fieldHeroImage')} className="object-cover" fill sizes="448px" src={heroImageUrl} />
              </div>
            ) : <p className="type-field-value text-muted-foreground">{t('notSet')}</p>}
          </InfoGroup>
          <InfoGroup
            description={tEdit('productPhotosOverviewHint')}
            label={tEdit('fieldProductPhotos')}
          >
            {productPhotos.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {productPhotos.map((photo, index) => (
                  <div key={`${photo}-${index}`} className="relative aspect-square overflow-hidden rounded-xl bg-muted">
                    <Image alt={`${tEdit('fieldProductPhotos')} ${index + 1}`} className="object-cover" fill sizes="176px" src={photo} />
                  </div>
                ))}
              </div>
            ) : <p className="type-field-value text-muted-foreground">{t('notSet')}</p>}
          </InfoGroup>
        </div>
      </OwnerSection>

      <OwnerSection description={t('sectionLinksHint')} editHref={`${editBase}2`} title={tEdit('wizardStepLinks')} editLabel={t('edit')}>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <InfoField label={tEdit('fieldInstagram')} value={display(brand.socialInstagram, t('notSet'))} />
          <InfoField label={tEdit('fieldThreads')} value={display(brand.socialThreads, t('notSet'))} />
          <InfoField label={tEdit('fieldFacebook')} value={display(brand.socialFacebook, t('notSet'))} />
          <InfoField label={tEdit('fieldOfficialWebsite')} value={display(brand.purchaseWebsite, t('notSet'))} />
          <InfoField label="Pinkoi" value={display(brand.purchasePinkoi, t('notSet'))} />
          <InfoField label={tEdit('fieldShopee')} value={display(brand.purchaseShopee, t('notSet'))} />
          <InfoField
            label={tEdit('fieldOtherLinks')}
            value={brand.otherUrls.length > 0 ? brand.otherUrls.map(({ label, url }) => `${label}: ${url}`).join('\n') : <EmptyValue>{t('notSet')}</EmptyValue>}
            wide
          />
        </dl>
      </OwnerSection>

      <OwnerSection description={t('sectionLocationsHint')} editHref={`${editBase}3`} title={tEdit('wizardStepLocations')} editLabel={t('edit')} prominentEdit>
        {retailLocations.length > 0 ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            {retailLocations.map((location, index) => {
              const isConfirmed = isConfirmedRetailLocation(location)
              const isUnconfirmed = isUnconfirmedRetailLocation(location)
              const isRetailChain = isRetailChainChannel(location)
              const statusLabel = isConfirmed
                ? tEdit('ownerConfirmationLabel')
                : isUnconfirmed
                  ? tEdit('locationVerificationNeedsReview')
                  : tEdit('informationKindRetailChain')

              return (
                <div key={`${location.name}-${index}`} className="rounded-lg bg-secondary p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="type-field-label">{location.name}</dt>
                    <Badge
                      variant={
                        isConfirmed
                          ? 'verified'
                          : isUnconfirmed
                            ? 'warning'
                            : 'secondary'
                      }
                    >
                      {statusLabel}
                    </Badge>
                  </div>
                  <dd className="mt-1 type-form-hint">
                    {isRetailChain
                      ? tEdit('locationNetworkChain')
                      : tEdit(locationTypeLabelKey(location.relationshipType))}
                  </dd>
                  <dd className="mt-1 break-words type-field-value">
                    {(isRetailChain ? location.retailerUrl : location.address) || (
                      <EmptyValue>{t('notSet')}</EmptyValue>
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
        ) : <p className="type-field-value text-muted-foreground">{t('notSet')}</p>}
      </OwnerSection>

      {verification ? (
        <OwnerSection
          description={t('sectionVerificationHint')}
          title={t('sectionVerification')}
        >
          {verification}
        </OwnerSection>
      ) : null}

      <OwnerSection description={t('sectionReputationHint')} editHref={`${editBase}4`} title={tEdit('wizardStepReputation')} editLabel={t('edit')}>
        <dl className="space-y-5">
          <InfoField label={tEdit('fieldReputationSummary')} value={display(brand.reputationSummary?.text, t('notSet'))} wide />
          <InfoField
            label={tEdit('fieldProvenanceSources')}
            value={brand.reputationSummary?.sources.length
              ? brand.reputationSummary.sources.map(({ url }) => url).join('\n')
              : <EmptyValue>{t('notSet')}</EmptyValue>}
            wide
          />
        </dl>
      </OwnerSection>
    </div>
  )
}
