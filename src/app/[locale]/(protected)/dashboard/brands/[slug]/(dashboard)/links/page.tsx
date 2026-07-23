import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SectionDetailLayout } from '@/components/dashboard/section-detail-layout'
import { Badge } from '@/components/ui/badge'
import { InfoField, InfoGroup } from '@/components/ui/card'
import {
  isConfirmedRetailLocation,
  isRetailChainChannel,
  isUnconfirmedRetailLocation,
  normalizeRetailLocations,
} from '@/lib/brands/locations'
import { getBrandBySlug } from '@/lib/services/brands'
import type { RetailLocationRelationshipType } from '@/lib/types/brand'

type Props = {
  params: Promise<{ locale: string; slug: string }>
}

function EmptyValue({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

function display(value: string | null | undefined, fallback: string) {
  return value === null || value === undefined || value === ''
    ? <EmptyValue>{fallback}</EmptyValue>
    : value
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

export default async function LinksPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const brand = await getBrandBySlug(slug)
  const [t, tEdit] = await Promise.all([
    getTranslations({ locale, namespace: 'dashboard.brandProfile' }),
    getTranslations({ locale, namespace: 'dashboard.edit' }),
  ])
  const retailLocations = normalizeRetailLocations(brand.retailLocations)

  return (
    <SectionDetailLayout
      description={t('sectionLinksHint')}
      editHref={`/dashboard/brands/${slug}/edit?step=2`}
      editLabel={t('edit')}
      title={tEdit('wizardStepLinks')}
    >
      <div className="space-y-8">
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <InfoField
            label={tEdit('fieldInstagram')}
            value={display(brand.socialInstagram, t('notSet'))}
          />
          <InfoField
            label={tEdit('fieldThreads')}
            value={display(brand.socialThreads, t('notSet'))}
          />
          <InfoField
            label={tEdit('fieldFacebook')}
            value={display(brand.socialFacebook, t('notSet'))}
          />
          <InfoField
            label={tEdit('fieldOfficialWebsite')}
            value={display(brand.purchaseWebsite, t('notSet'))}
          />
          <InfoField
            label="Pinkoi"
            value={display(brand.purchasePinkoi, t('notSet'))}
          />
          <InfoField
            label={tEdit('fieldShopee')}
            value={display(brand.purchaseShopee, t('notSet'))}
          />
          <InfoField
            label={tEdit('fieldOtherLinks')}
            value={
              brand.otherUrls.length > 0
                ? brand.otherUrls
                    .map(({ label, url }) => `${label}: ${url}`)
                    .join('\n')
                : <EmptyValue>{t('notSet')}</EmptyValue>
            }
            wide
          />
        </dl>

        <InfoGroup
          description={t('sectionLocationsHint')}
          label={tEdit('wizardStepLocations')}
        >
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
                  <div
                    key={`${location.name}-${index}`}
                    className="rounded-lg bg-secondary p-4"
                  >
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
                        : tEdit(
                            locationTypeLabelKey(location.relationshipType),
                          )}
                    </dd>
                    <dd className="mt-1 break-words type-field-value">
                      {(isRetailChain
                        ? location.retailerUrl
                        : location.address) || (
                        <EmptyValue>{t('notSet')}</EmptyValue>
                      )}
                    </dd>
                  </div>
                )
              })}
            </dl>
          ) : (
            <p className="type-field-value text-muted-foreground">
              {t('notSet')}
            </p>
          )}
        </InfoGroup>
      </div>
    </SectionDetailLayout>
  )
}
