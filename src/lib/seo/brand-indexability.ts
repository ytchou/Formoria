import { languagePurity } from '@/lib/services/eval/scorers'

const ENGLISH_PURITY_THRESHOLD = 0.95

export type BrandIndexabilityInput = {
  description: string | null | undefined
  descriptionEn: string | null | undefined
  blurbEn: string | null | undefined
}

export type BrandIndexability = {
  'zh-TW': boolean
  en: boolean
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isEnglish(value: string | null | undefined): value is string {
  return hasText(value) && languagePurity(value, 'en') >= ENGLISH_PURITY_THRESHOLD
}

export function getBrandIndexability(
  brand: BrandIndexabilityInput,
): BrandIndexability {
  return {
    'zh-TW': hasText(brand.description),
    en: isEnglish(brand.descriptionEn) && isEnglish(brand.blurbEn),
  }
}

