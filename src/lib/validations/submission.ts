import { z } from 'zod/v3'
import { CITY_SLUGS, type CitySlug } from '@/lib/constants/taiwan-cities'
import { SOURCE_ATTRIBUTION_VALUES } from '@/lib/types/submission'
import { isPrivateUrl } from '@/lib/url'

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
    .trim()
    .url(message)
    .refine(hasHttpScheme, message ?? 'Invalid URL scheme')
    .refine((value) => !isPrivateUrl(value), message ?? 'Invalid URL')
}

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Visitors type a bare domain (`brand.com`) far more often than a full URL.
 * Prepend `https://` when no scheme is present; an explicit scheme — including
 * `http://` — is kept as typed. Empty stays empty so the required check still
 * fires.
 */
export function normalizeWebsiteUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || URL_SCHEME.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
})

function hasMinimumVisibleCharacters(value: string, minimum: number) {
  return Array.from(graphemeSegmenter.segment(value)).length >= minimum
}

function buildFieldSchemas(t: Translator) {
  const nameField = z
    .string()
    .trim()
    .max(100)
    .refine((value) => hasMinimumVisibleCharacters(value, 2), {
      message: t('validation.nameMinLength'),
    })
  // Preprocessed so both the client resolver and the server action's parse
  // see the same normalised URL.
  const websiteField = z.preprocess(
    (value) => (typeof value === 'string' ? normalizeWebsiteUrl(value) : value),
    httpUrl(t('validation.urlInvalid')),
  )

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

function getBotDetectionSchema(t: Translator) {
  return z.object({
    turnstileToken: z.string().min(1, t('validation.turnstileRequired')),
    honeypot: z.string().optional().default(''),
  })
}

// ---- Static fallback schemas (zh-TW hardcoded) for server contexts that
// cannot easily obtain a request-scoped translator. Prefer the factory
// variants (get*Schema) in all new call sites. ----
const zhT = (key: string): string => {
  const map: Record<string, string> = {
    'validation.nameMinLength': '品牌名稱至少要 2 個字',
    'validation.descriptionRequired': '請填寫品牌介紹',
    'validation.emailInvalid': '請輸入有效的電子郵件地址',
    'validation.heroImageRequired': '請上傳品牌主圖',
    'validation.platformRequired': '請選擇平台',
    'validation.urlInvalid': '請輸入完整網址，例如 https://brand.com',
    'validation.pdpaRequired': '請勾選同意隱私權政策',
    'validation.turnstileRequired': '請完成真人驗證',
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
        heroImageUrl: z
          .string()
          .url()
          .optional()
          .nullable()
          .or(z.literal('')),
        description: z.string().max(500).optional().default(''),
      }),
    )
    .merge(getReviewSchema(t))
    .merge(getBotDetectionSchema(t))
}

function recommendationSubmissionObject(t: Translator) {
  return baseSubmissionSchema(t).merge(
    z.object({
      sourceAttribution: sourceAttributionEnum,
      guestEmail: optionalEmail(t('validation.emailInvalid')),
      marketingEmailOptIn: z.boolean().default(false),
      duplicateConfirmed: z.boolean().default(false),
    }),
  )
}

export function createRecommendationSubmissionSchema(t: Translator = zhT) {
  return recommendationSubmissionObject(t)
    .superRefine((data, context) => {
      if (data.marketingEmailOptIn && !data.guestEmail?.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['guestEmail'],
          message: t('validation.emailRequiredForNewsletter'),
        })
      }
    })
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
        romanizedName: z
          .string()
          .min(2)
          .max(100)
          .regex(/^[a-zA-Z0-9\s\-'.]+$/)
          .optional()
          .or(z.literal('')),
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

export const fullSubmissionSchema = recommendationSubmissionObject(zhT)

export type SubmissionFormData = {
  name: string
  website: string
  description?: string
  heroImageUrl?: string | null
  guestEmail?: string
  marketingEmailOptIn?: boolean
  duplicateConfirmed?: boolean
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
