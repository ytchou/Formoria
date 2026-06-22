import { z } from 'zod/v3'
import { SOURCE_ATTRIBUTION_VALUES } from '@/lib/types/submission'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

type Translator = (key: string) => string

const httpsUrl = z.string().url().max(2048).startsWith('https://')

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

export const scrapeUrlSchema = z.object({
  urls: z
    .array(httpsUrl)
    .min(1)
    .transform((a) => [...new Set(a)])
    .pipe(z.array(httpsUrl).max(3)),
})

function buildFieldSchemas(t: Translator) {
  const nameField = z.string().min(2, t('validation.nameMinLength')).max(100)
  const descriptionField = z.string().max(500).optional().or(z.literal(''))
  const categoryField = z.string().optional().default('')
  const regionField = z.string().min(1, t('validation.regionRequired'))
  const websiteField = httpUrl(t('validation.urlInvalid'))
  const valueTagsField = z.array(z.string()).max(3, t('validation.valueTagsMax')).optional().default([])

  const purchaseLinkSchema = z.object({
    platform: z.string().min(1, t('validation.platformRequired')),
    url: httpUrl(t('validation.urlInvalid')),
  })

  const socialLinksSchema = z.object({
    instagram: z.string(),
    threads: z.string(),
    facebook: z.string(),
    website: httpUrl(t('validation.urlInvalid')).or(z.literal('')),
  })

  const retailLocationSchema = z.object({
    name: z.string().min(1, t('validation.locationNameRequired')),
    address: z.string().min(1, t('validation.addressRequired')),
  })

  return {
    nameField,
    descriptionField,
    categoryField,
    regionField,
    websiteField,
    valueTagsField,
    purchaseLinkSchema,
    socialLinksSchema,
    retailLocationSchema,
  }
}

export function getBrandInfoSchema(t: Translator) {
  const {
    nameField,
    descriptionField,
    categoryField,
    regionField,
    websiteField,
    valueTagsField,
  } = buildFieldSchemas(t)
  return z.object({
    name: nameField,
    description: descriptionField,
    category: categoryField,
    website: websiteField,
    unifiedBusinessNumber: z.string()
      .regex(/^\d{8}$/, t('validation.ubn_format'))
      .or(z.literal(''))
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    region: regionField,
    valueTags: valueTagsField,
    heroImageUrl: httpUrl().optional().or(z.literal('')),
  })
}

export const BrandInfoSchema = getBrandInfoSchema

export function getProductsSchema(_t: Translator) {
  void _t

  return z.object({
    productPhotos: z.array(z.string()).max(6).optional().default([]),
    brandHighlights: z.string().max(300).optional().default(''),
    productType: z
      .string()
      .optional()
      .default('')
      .refine(
        (slug) =>
          slug === '' || PRODUCT_TYPE_CATEGORIES.some((category) => category.slug === slug),
        'Invalid product type slug'
      ),
    productTypeNote: z.string().max(200).optional().default(''),
  })
}

export function getLinksSchema(t: Translator) {
  const { purchaseLinkSchema, socialLinksSchema, retailLocationSchema } =
    buildFieldSchemas(t)
  return z.object({
    purchaseLinks: z
      .array(purchaseLinkSchema)
      .optional()
      .default([]),
    socialLinks: socialLinksSchema.optional().default({
      instagram: '',
      threads: '',
      facebook: '',
      website: '',
    }),
    retailLocations: z.array(retailLocationSchema).optional().default([]),
  })
}

export function getReviewSchema(t: Translator) {
  return z.object({
    pdpaConsent: z.boolean().refine((v) => v === true, {
      message: t('validation.pdpaRequired'),
    }),
  })
}

export function getBotDetectionSchema(_t: Translator) {
  void _t
  return z.object({
    turnstileToken: z.string().min(1),
    _honeypot: z.string().max(0).optional(),
  })
}

// ---- Static fallback schemas (zh-TW hardcoded) for server contexts that
// cannot easily obtain a request-scoped translator. Prefer the factory
// variants (get*Schema) in all new call sites. ----
const zhT = (key: string): string => {
  const map: Record<string, string> = {
    'validation.nameMinLength': '品牌名稱至少需要 2 個字元',
    'validation.descriptionMinLength': '品牌介紹至少需要 40 個字元',
    'validation.categoryRequired': '請選擇分類',
    'validation.regionRequired': '請選擇地區',
    'validation.tagsMax': '最多可選擇 5 個標籤',
    'validation.valueTagsMax': '最多可選擇 3 個品牌價值',
    'validation.logoRequired': '請上傳品牌標誌',
    'validation.photosMax': '最多可上傳 6 張照片',
    'validation.platformRequired': '請選擇平台',
    'validation.urlInvalid': '請輸入有效的網址',
    'validation.locationNameRequired': '請輸入地點名稱',
    'validation.addressRequired': '請輸入地址',
    'validation.purchaseLinksMin': '請提供至少一個購買連結',
    'validation.pdpaRequired': '請同意隱私政策',
    'validation.turnstileRequired': '請完成驗證',
    'validation.ubn_format': '統一編號須為8位數字',
  }
  return map[key] ?? key
}

export const brandInfoSchema = getBrandInfoSchema(zhT)
export const descriptionField = z.string().max(500).optional().or(z.literal(''))
export const productsSchema = getProductsSchema(zhT)
export const linksSchema = getLinksSchema(zhT)
export const reviewSchema = getReviewSchema(zhT)
export const botDetectionSchema = getBotDetectionSchema(zhT)

const sourceAttributionEnum = z.enum(SOURCE_ATTRIBUTION_VALUES)

const ownerFields = z.object({
  isOwner: z.boolean(),
  sourceAttribution: sourceAttributionEnum.optional(),
})

type OwnerFields = z.infer<typeof ownerFields>

function requireSourceAttribution<Schema extends z.ZodType>(
  schema: Schema
): z.ZodEffects<Schema>
function requireSourceAttribution<Schema extends z.AnyZodObject>(
  schema: Schema,
  preserveObjectMethods: true
): z.ZodEffects<Schema> & Schema
function requireSourceAttribution<Schema extends z.ZodType>(
  schema: Schema,
  preserveObjectMethods = false
) {
  const refined = schema.superRefine((data: OwnerFields, ctx) => {
    if (data.isOwner === false && data.sourceAttribution === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '請選擇資料來源',
        path: ['sourceAttribution'],
      })
    }
  })

  if (!preserveObjectMethods) {
    return refined
  }

  return new Proxy(refined, {
    get(target, property, receiver) {
      if (property in target) {
        return Reflect.get(target, property, receiver)
      }

      const value = Reflect.get(schema, property, schema)
      if (typeof value !== 'function') {
        return value
      }

      return (...args: unknown[]) => {
        const result = Reflect.apply(value, schema, args)
        if (result instanceof z.ZodObject && 'isOwner' in result.shape) {
          return requireSourceAttribution(result, true)
        }
        return result
      }
    },
  }) as z.ZodEffects<Schema> & Schema
}

/**
 * Schema factory for brand submission validation.
 * - isOwner=false: sourceAttribution is required
 *
 * Accepts an optional translator so Zod error messages can be localised.
 * Falls back to zh-TW strings when no translator is provided (server actions
 * that call getTranslations should pass the result here).
 */
export function createSubmissionSchema(isOwner: boolean, t: Translator = zhT) {
  const {
    nameField,
    descriptionField: descField,
    categoryField,
    regionField,
    websiteField,
    valueTagsField,
    purchaseLinkSchema,
    socialLinksSchema,
    retailLocationSchema,
  } = buildFieldSchemas(t)

  const brandInfoBase = z.object({
    name: nameField,
    description: descField,
    category: categoryField,
    website: websiteField,
    unifiedBusinessNumber: z.string()
      .regex(/^\d{8}$/, t('validation.ubn_format'))
      .or(z.literal(''))
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    region: regionField,
    valueTags: valueTagsField,
    heroImageUrl: httpUrl().optional().or(z.literal('')),
  })

  const linksBase = z.object({
    purchaseLinks: z.array(purchaseLinkSchema).optional().default([]),
    socialLinks: socialLinksSchema.optional().default({
      instagram: '',
      threads: '',
      facebook: '',
      website: '',
    }),
    retailLocations: z.array(retailLocationSchema).optional().default([]),
  })

  const reviewBase = z.object({
    pdpaConsent: z.boolean().refine((v) => v === true, {
      message: t('validation.pdpaRequired'),
    }),
  })

  const botDetectionBase = z.object({
    turnstileToken: z.string().min(1),
    _honeypot: z.string().max(0).optional(),
  })

  const schema = brandInfoBase
    .merge(getProductsSchema(t))
    .merge(linksBase)
    .merge(reviewBase)
    .merge(botDetectionBase)
    .merge(
      ownerFields.extend({
        isOwner: z.boolean().default(isOwner),
      })
    )

  return requireSourceAttribution(schema, true)
}

export { SOURCE_ATTRIBUTION_VALUES }

export const fullSubmissionSchema = requireSourceAttribution(
  brandInfoSchema
    .merge(productsSchema)
    .merge(linksSchema)
    .merge(reviewSchema)
    .merge(botDetectionSchema)
    .merge(ownerFields),
  true
)

export function getFullSubmissionSchema(t: Translator) {
  return requireSourceAttribution(
    getBrandInfoSchema(t)
      .merge(getProductsSchema(t))
      .merge(getLinksSchema(t))
      .merge(getReviewSchema(t))
      .merge(getBotDetectionSchema(t))
      .merge(ownerFields),
    true
  )
}

type FullSubmissionSchemaData = z.infer<typeof fullSubmissionSchema>

export type SubmissionFormData = Omit<
  FullSubmissionSchemaData,
  | 'productTypeNote'
  | 'productType'
  | 'valueTags'
  | 'brandHighlights'
  | 'purchaseLinks'
  | 'socialLinks'
  | 'heroImageUrl'
> & {
  productTypeNote?: string
  productType?: string
  valueTags?: string[]
  brandHighlights?: string
  purchaseLinks?: FullSubmissionSchemaData['purchaseLinks']
  socialLinks?: FullSubmissionSchemaData['socialLinks']
  heroImageUrl?: string
}
