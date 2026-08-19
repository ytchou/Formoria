import { SurfaceImage } from '@/components/ui/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SectionDetailLayout } from '@/components/dashboard/section-detail-layout'
import { InfoGroup } from '@/components/ui/card'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { getBrandBySlug } from '@/lib/services/brands'
import { routes } from '@/lib/routes'

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
      editHref={`${routes.dashboard.brandEdit(slug)}?step=1`}
      editLabel={t('edit')}
      title={tEdit('wizardStepMedia')}
    >
      <div className="space-y-6">
        <InfoGroup
          description={tEdit('heroImageOverviewHint')}
          label={tEdit('fieldHeroImage')}
        >
          {heroImageUrl ? (
            <div className="relative aspect-video max-w-md overflow-hidden rounded-[3px] bg-surface-deep">
              <SurfaceImage
                alt={tEdit('fieldHeroImage')}
                className="object-cover"
                fill
                // Measured, with no surface to name: `max-w-md` on THIS div caps
                // the preview at a fixed 448px.
                sizes="448px"
                src={heroImageUrl}
              />
            </div>
          ) : (
            <p className="type-body-sm text-ink-muted">
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
                  className="relative aspect-square overflow-hidden rounded-[3px] bg-surface-deep"
                >
                  <SurfaceImage
                    alt={`${tEdit('fieldProductPhotos')} ${index + 1}`}
                    className="object-contain"
                    fill
                    /*
                     * Measured, with no surface to name: 2/3/4 columns is this
                     * page's grid alone, not any of the shared card grids.
                     *
                     * The old 176px cited `max-w-md`, which is on the hero
                     * preview's SIBLING div above, not on any ancestor of this
                     * grid. The real column is the dashboard `<main>`'s
                     * `page-measure` (80rem), so a four-up cell is ~280px and
                     * every thumbnail was being requested at a size it then had
                     * to upscale. The vw steps read slightly high because they
                     * ignore the gutters, which is the safe direction for a hint.
                     */
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 288px"
                    src={photo}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="type-body-sm text-ink-muted">
              {t('notSet')}
            </p>
          )}
        </InfoGroup>
      </div>
    </SectionDetailLayout>
  )
}
