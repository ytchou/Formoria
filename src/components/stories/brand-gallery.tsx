import { getLocale, getTranslations } from 'next-intl/server'

import { MissingBrandNotice, type BrandLoaderSeam } from './brand-card-mdx'
import {
  getBrandImageFields,
  getPublicBrandsBySlugs,
  type BrandImageFields,
} from '@/lib/services/brands'
import { normalizePublicBrandCard } from '@/lib/brands/contracts'
import { getBrandGalleryImageEntries } from '@/lib/services/brand-images'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { brandImageFill } from '@/lib/images/fill'
import { cn } from '@/lib/utils'

type BrandGalleryProps = {
  slug: string
  caption?: string
  /** Test seam, same rationale as `loadBrands`. */
  loadImages?: (brandId: string) => Promise<BrandImageFields>
} & BrandLoaderSeam

/**
 * `<BrandGallery slug="…" caption="…" />` inside story MDX.
 *
 * Sources images from the brand listing rather than hard-coded Supabase
 * storage URLs so the story stays in sync with the directory. Every prop is a
 * plain string because MDX drops expression attributes (`prop={…}`) in this
 * setup (DEV-1302).
 */
export async function BrandGallery({
  slug,
  caption,
  loadBrands = getPublicBrandsBySlugs,
  loadImages = getBrandImageFields,
}: BrandGalleryProps) {
  const brands = await loadBrands([slug])
  const resolvedBrand = brands.get(slug)
  const brand = resolvedBrand ? normalizePublicBrandCard(resolvedBrand) : undefined
  const t = await getTranslations('stories')

  if (!brand) {
    return <MissingBrandNotice label={t('brandMissing', { slug })} />
  }

  // `loadBrands` uses the narrow directory projection, so `brand.productPhotos`
  // is empty and the brand alone would only ever fill one cell of the grid. Fall
  // back to it when a brand has no `brand_images` rows at all — the denormalized
  // `hero_image_url` is still worth one photo.
  const imageFields = await loadImages(brand.id)
  const source = imageFields.heroImageUrl ? imageFields : brand

  // Entries, not bare URLs: `getBrandGalleryImageEntries` drops a null hero,
  // which shifts every later position against `source.imageAlts`. That index
  // now selects fill mode (`isLogo`) as well as alt text, so indexing by array
  // position would letterbox a photo and crop a logo. Two independent filters
  // shift this list — the null hero here and the unsafe-host filter below — and
  // `sourceIndex` survives both.
  const entries = getBrandGalleryImageEntries(source)
  const locale = await getLocale()
  const isEnglish = locale === 'en'

  // `toImageFields` builds `active` as active rows sorted by `sort_order`, then
  // sets `heroImageUrl = active[0].url`, `productPhotos = active.slice(1).map`
  // and `imageAlts = active.map(...)`; index into it by `sourceIndex`.
  const images = entries
    .map(({ url, sourceIndex: index }) => {
      const imageAlt = source.imageAlts[index]
      const heroMetadata = index === 0 ? source.heroImageMetadata : null
      const preferredAlt = isEnglish ? imageAlt?.altEn : imageAlt?.altZh
      const otherAlt = isEnglish ? imageAlt?.altZh : imageAlt?.altEn
      const metadataPreferredAlt = isEnglish ? heroMetadata?.altEn : heroMetadata?.altZh
      const metadataOtherAlt = isEnglish ? heroMetadata?.altZh : heroMetadata?.altEn
      const alt =
        preferredAlt ||
        metadataPreferredAlt ||
        otherAlt ||
        metadataOtherAlt ||
        t('galleryImageAlt', { brand: brand.name })

      // The whole meta rides along rather than three unpacked fields: this is
      // the same `BrandImageMeta` the shared fill helper takes, so nothing has
      // to be re-flattened at the render site.
      return { url, alt, meta: imageAlt ?? null }
    })
    .flatMap((image) => {
      const src = safeImageSrc(image.url)
      return src ? [{ src, alt: image.alt, meta: image.meta }] : []
    })
    .slice(0, 4)

  if (images.length === 0) return null

  return (
    <figure className="prose-measure mx-auto mt-7 mb-6 w-full">
      <div className="grid grid-cols-2 gap-2">
        {images.map(({ src, alt, meta }, index) => {
          // `cn()` like every other surface — this was the one site building its
          // class list with a template literal.
          const fill = brandImageFill(meta, { inset: 'p-6' })
          return (
            // eslint-disable-next-line @next/next/no-img-element -- remote listing URL with no intrinsic size; raw img keeps arbitrary allowed hosts working without next/image configuration.
            <img
              key={`${index}-${src}`}
              src={src}
              alt={alt}
              loading="lazy"
              decoding="async"
              className={cn(
                'aspect-media w-full rounded-surface border border-rule bg-surface-deep',
                fill,
              )}
            />
          )
        })}
      </div>
      {caption ? <figcaption className="mt-2 type-metadata">{caption}</figcaption> : null}
    </figure>
  )
}
