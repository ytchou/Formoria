import Image from 'next/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SectionDetailLayout } from '@/components/dashboard/section-detail-layout'
import { InfoGroup } from '@/components/ui/card'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { getBrandBySlug } from '@/lib/services/brands'

type Props = {
  params: Promise<{ locale: string; slug: string }>
}

export default async function MediaPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const brand = await getBrandBySlug(slug)
  const [t, tEdit] = await Promise.all([
    getTranslations({ locale, namespace: 'dashboard.brandProfile' }),
    getTranslations({ locale, namespace: 'dashboard.edit' }),
  ])
  const heroImageUrl = safeImageSrc(brand.heroImageUrl)
  const productPhotos = brand.productPhotos
    .map((photo) => safeImageSrc(photo))
    .filter((photo): photo is string => photo !== null)

  return (
    <SectionDetailLayout
      description={t('sectionBrandImagesHint')}
      editHref={`/dashboard/brands/${slug}/edit?step=1`}
      editLabel={t('edit')}
      title={tEdit('wizardStepMedia')}
    >
      <div className="space-y-6">
        <InfoGroup
          description={tEdit('heroImageOverviewHint')}
          label={tEdit('fieldHeroImage')}
        >
          {heroImageUrl ? (
            <div className="relative aspect-video max-w-md overflow-hidden rounded-xl bg-muted">
              <Image
                alt={tEdit('fieldHeroImage')}
                className="object-cover"
                fill
                sizes="448px"
                src={heroImageUrl}
              />
            </div>
          ) : (
            <p className="type-field-value text-muted-foreground">
              {t('notSet')}
            </p>
          )}
        </InfoGroup>

        <InfoGroup
          description={tEdit('productPhotosOverviewHint')}
          label={tEdit('fieldProductPhotos')}
        >
          {productPhotos.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {productPhotos.map((photo, index) => (
                <div
                  key={`${photo}-${index}`}
                  className="relative aspect-square overflow-hidden rounded-xl bg-muted"
                >
                  <Image
                    alt={`${tEdit('fieldProductPhotos')} ${index + 1}`}
                    className="object-cover"
                    fill
                    sizes="176px"
                    src={photo}
                  />
                </div>
              ))}
            </div>
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
