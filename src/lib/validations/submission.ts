import { z } from 'zod/v3'
import { CITY_SLUGS, type CitySlug } from '@/lib/constants/taiwan-cities'
import { SOURCE_ATTRIBUTION_VALUES } from '@/lib/types/submission'

type Translator = (key: string) => string

function hasHttpScheme(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function httpUrl(message?: string) {
  return z
    .string()
    .url(message)
    .refine(hasHttpScheme, message ?? 'Invalid URL scheme')
}

function buildFieldSchemas(t: Translator) {
  const nameField = z.string().min(2, t('validation.nameMinLength')).max(100)
  const websiteField = httpUrl(t('validation.urlInvalid'))

  const purchaseLinkSchema = z.object({
    platform: z.string().min(1, t('validation.platformRequired')),
    url: httpUrl(t('validation.urlInvalid')),
  })

  const socialLinksSchema = z.object({
    instagram: z.string().optional().default(''),
    threads: z.string().optional().default(''),
    facebook: httpUrl(t('validation.urlInvalid'))
      .or(z.literal(''))
      .optional()
      .default(''),
    pinkoi: httpUrl(t('validation.urlInvalid'))
      .or(z.literal(''))
      .optional()
      .default(''),
    shopee: httpUrl(t('validation.urlInvalid'))
      .or(z.literal(''))
      .optional()
      .default(''),
    website: httpUrl(t('validation.urlInvalid'))
      .or(z.literal(''))
      .optional()
      .default(''),
  })

  return {
    nameField,
    websiteField,
    purchaseLinkSchema,
    socialLinksSchema,
  }
}

function getBrandInfoSchema(t: Translator) {
  const { nameField, websiteField } = buildFieldSchemas(t)
  return z.object({
    name: nameField,
    website: websiteField,
    city: z.enum(CITY_SLUGS).optional(),
  })
}

export function getLinksSchema(t: Translator) {
  const { purchaseLinkSchema, socialLinksSchema } = buildFieldSchemas(t)
  return z.object({
    purchaseLinks: z.array(purchaseLinkSchema).optional().default([]),
    socialLinks: socialLinksSchema.optional().default({
      instagram: '',
      threads: '',
      facebook: '',
      pinkoi: '',
      shopee: '',
      website: '',
    }),
  })
}

function getReviewSchema(t: Translator) {
  return z.object({
    pdpaConsent: z.boolean().refine((v) => v === true, {
      message: t('validation.pdpaRequired'),
    }),
  })
}

function getBotDetectionSchema(_t: Translator) {
  void _t
  return z.object({
    turnstileToken: z.string().min(1),
    honeypot: z.string().max(0).optional().default(''),
  })
}

// ---- Static fallback schemas (zh-TW hardcoded) for server contexts that
// cannot easily obtain a request-scoped translator. Prefer the factory
// variants (get*Schema) in all new call sites. ----
const zhT = (key: string): string => {
  const map: Record<string, string> = {
    'validation.nameMinLength': '品牌名稱至少需要 2 個字元',
    'validation.descriptionRequired': '請填寫品牌簡介',
    'validation.emailInvalid': '請輸入有效的電子郵件地址',
    'validation.heroImageRequired': '請上傳品牌主圖',
    'validation.platformRequired': '請選擇平台',
    'validation.urlInvalid': '請輸入有效的網址',
    'validation.pdpaRequired': '請同意隱私政策',
    'validation.turnstileRequired': '請完成驗證',
  }
  return map[key] ?? key
}

const sourceAttributionEnum = z.enum(SOURCE_ATTRIBUTION_VALUES)

function optionalEmail(message: string) {
  return z.string().email(message).or(z.literal('')).optional().default('')
}

function baseSubmissionSchema(t: Translator) {
  return getBrandInfoSchema(t)
    .merge(
      z.object({
        heroImageUrl: z.string().url().optional().or(z.literal('')),
        description: z.string().max(500).optional().default(''),
      }),
    )
    .merge(getReviewSchema(t))
    .merge(getBotDetectionSchema(t))
}

export function createRecommendationSubmissionSchema(t: Translator = zhT) {
  return baseSubmissionSchema(t).merge(
    z.object({
      sourceAttribution: sourceAttributionEnum,
      guestEmail: optionalEmail(t('validation.emailInvalid')),
    }),
  )
}

export function createOwnerSubmissionSchema(t: Translator = zhT) {
  return baseSubmissionSchema(t)
    .merge(
      z.object({
        description: z
          .string()
          .trim()
          .min(1, t('validation.descriptionRequired'))
          .max(500),
        heroImageUrl: z
          .string()
          .min(1, t('validation.heroImageRequired'))
          .url(t('validation.urlInvalid')),
      }),
    )
    .merge(getLinksSchema(t))
    .merge(
      z.object({
        city: z.enum(CITY_SLUGS).optional(),
        mitSmileCert: z.string().optional().default(''),
      }),
    )
}

/**
 * Schema factory for brand submission validation.
 * Compatibility wrapper used by older tests/callers.
 *
 * Accepts an optional translator so Zod error messages can be localised.
 * Falls back to zh-TW strings when no translator is provided (server actions
 * that call getTranslations should pass the result here).
 */
export function createSubmissionSchema(isOwner: boolean, t: Translator = zhT) {
  return isOwner
    ? createOwnerSubmissionSchema(t)
    : createRecommendationSubmissionSchema(t)
}

export const fullSubmissionSchema = createRecommendationSubmissionSchema(zhT)

export type SubmissionFormData = {
  name: string
  website: string
  description?: string
  heroImageUrl?: string | null
  guestEmail?: string
  sourceAttribution?: z.infer<typeof sourceAttributionEnum>
  city?: CitySlug
  mitSmileCert?: string
  pdpaConsent: boolean
  turnstileToken: string
  honeypot?: string
  purchaseLinks?: z.infer<ReturnType<typeof getLinksSchema>>['purchaseLinks']
  socialLinks?: Partial<
    z.infer<ReturnType<typeof getLinksSchema>>['socialLinks']
  >
}
