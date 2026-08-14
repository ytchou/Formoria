import type { Brand } from '@/lib/types/brand'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'

export type BrandCardImageFields = Pick<
  Brand,
  'heroImageUrl' | 'productPhotos' | 'imageAlts'
>

export type SelectedBrandCardImage = {
  src: string
  meta: Brand['imageAlts'][number] | undefined
}

/**
 * Selects the first renderable product photo, falling back to the first
 * renderable image. `imageAlts` stays paired with the same source index so
 * fill mode and focal position cannot drift from the image that renders.
 */
export function selectBrandCardImage(
  fields: BrandCardImageFields,
): SelectedBrandCardImage | null {
  const candidates = [fields.heroImageUrl, ...fields.productPhotos].map((url) =>
    safeImageSrc(url),
  )
  const preferredIndex = candidates.findIndex(
    (src, index) => src !== null && fields.imageAlts.at(index)?.isLogo === false,
  )
  const imageIndex =
    preferredIndex >= 0
      ? preferredIndex
      : candidates.findIndex((src) => src !== null)
  const src = imageIndex >= 0 ? candidates.at(imageIndex) : undefined

  if (!src) return null

  return { src, meta: fields.imageAlts.at(imageIndex) }
}
