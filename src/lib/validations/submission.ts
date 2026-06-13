import { z } from 'zod/v3'
import { SOURCE_ATTRIBUTION_VALUES } from '@/lib/types/submission'

type Translator = (key: string) => string

const httpsUrl = z.string().url().max(2048).startsWith('https://')

export const scrapeUrlSchema = z.object({
  urls: z
    .array(httpsUrl)
    .min(1)
    .transform((a) => [...new Set(a)])
    .pipe(z.array(httpsUrl).max(3)),
})

function buildFieldSchemas(t: Translator) {
  const nameField = z.string().min(2, t('validation.nameMinLength')).max(100)
  const descriptionField = z
    .string()
    .min(40, t('validation.descriptionMinLength'))
    .max(2000)
  const categoryField = z.string().min(1, t('validation.categoryRequired'))
  const regionField = z.string().optional()
  const valueTagsField = z.array(z.string()).max(3, t('validation.valueTagsMax')).optional().default([])

  const purchaseLinkSchema = z.object({
    platform: z.string().min(1, t('validation.platformRequired')),
    url: z.string().url(t('validation.urlInvalid')),
  })

  const socialLinksSchema = z.object({
    instagram: z.string(),
    threads: z.string(),
    facebook: z.string(),
    website: z.string(),
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
    valueTagsField,
    purchaseLinkSchema,
    socialLinksSchema,
    retailLocationSchema,
  }
}

export function getBrandInfoSchema(t: Translator) {
  const { nameField, descriptionField, categoryField, regionField, valueTagsField } =
    buildFieldSchemas(t)
  return z.object({
    name: nameField,
    description: descriptionField,
    category: categoryField,
    region: regionField,
    valueTags: valueTagsField,
    logoUrl: z.string().url(t('validation.logoRequired')).min(1, t('validation.logoRequired')),
  })
}

export function getProductsSchema(t: Translator) {
  void t

  return z.object({
    productPhotos: z.array(z.string()).max(6),
    brandHighlights: z.string().max(300).optional().default(''),
    productTypes: z.array(z.string()).default([]),
    productTypeNote: z.string().max(200).optional().default(''),
  })
}

export function getLinksSchema(t: Translator) {
  const { purchaseLinkSchema, socialLinksSchema, retailLocationSchema } =
    buildFieldSchemas(t)
  return z.object({
    purchaseLinks: z
      .array(purchaseLinkSchema)
      .min(1, t('validation.purchaseLinksMin')),
    socialLinks: socialLinksSchema,
    retailLocations: z.array(retailLocationSchema),
  })
}

export function getReviewSchema(t: Translator) {
  return z.object({
    pdpaConsent: z.boolean().refine((v) => v === true, {
      message: t('validation.pdpaRequired'),
    }),
  })
}

export function getBotDetectionSchema(t: Translator) {
  return z.object({
    turnstileToken: z.string().min(1, t('validation.turnstileRequired')),
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
  }
  return map[key] ?? key
}

export const brandInfoSchema = getBrandInfoSchema(zhT)
export const descriptionField = z.string().min(40, zhT('validation.descriptionMinLength')).max(2000)
export const productsSchema = getProductsSchema(zhT)
export const linksSchema = getLinksSchema(zhT)
export const reviewSchema = getReviewSchema(zhT)
export const botDetectionSchema = getBotDetectionSchema(zhT)

const sourceAttributionEnum = z.enum(SOURCE_ATTRIBUTION_VALUES)

const ownerFields = z.object({
  isOwner: z.boolean(),
  sourceAttribution: sourceAttributionEnum.optional(),
})

type ProductTypeFields = {
  productTypeNote: string
  productTypes: string[]
}

function requireProductType<
  Output extends ProductTypeFields,
  Def extends z.ZodTypeDef,
  Input,
>(schema: z.ZodType<Output, Def, Input>) {
  return schema.refine(
    (data) =>
      data.productTypes.length > 0 || (data.productTypeNote?.trim().length ?? 0) > 0,
    {
      message: '請選擇至少一項產品類型，或說明你的產品類型',
      path: ['productTypes'],
    }
  )
}

/**
 * Schema factory for brand submission validation.
 * - isOwner=true: logoUrl and at least one purchaseLink are required
 * - isOwner=false: logoUrl and purchaseLinks are optional; sourceAttribution accepted
 *
 * Accepts an optional translator so Zod error messages can be localised.
 * Falls back to zh-TW strings when no translator is provided (server actions
 * that call getTranslations should pass the result here).
 */
export function createSubmissionSchema(isOwner: boolean, t: Translator = zhT) {
  const { nameField, descriptionField: descField, categoryField, regionField, valueTagsField, purchaseLinkSchema, socialLinksSchema, retailLocationSchema } =
    buildFieldSchemas(t)

  const brandInfoBase = z.object({
    name: nameField,
    description: descField,
    category: categoryField,
    region: regionField,
    valueTags: valueTagsField,
    logoUrl: isOwner
      ? z.string().url(t('validation.logoRequired')).min(1, t('validation.logoRequired'))
      : z.string().url().optional().or(z.literal('')),
  })

  const linksBase = z.object({
    purchaseLinks: isOwner
      ? z.array(purchaseLinkSchema).min(1, t('validation.purchaseLinksMin'))
      : z.array(purchaseLinkSchema).optional().default([]),
    socialLinks: socialLinksSchema,
    retailLocations: z.array(retailLocationSchema),
  })

  const reviewBase = z.object({
    pdpaConsent: z.boolean().refine((v) => v === true, {
      message: t('validation.pdpaRequired'),
    }),
  })

  const botDetectionBase = z.object({
    turnstileToken: z.string().min(1, t('validation.turnstileRequired')),
    _honeypot: z.string().max(0).optional(),
  })

  const schema = brandInfoBase
    .merge(getProductsSchema(t))
    .merge(linksBase)
    .merge(reviewBase)
    .merge(botDetectionBase)
    .merge(ownerFields)

  return schema
}

export { SOURCE_ATTRIBUTION_VALUES }

export const fullSubmissionSchema = requireProductType(
  brandInfoSchema
    .merge(productsSchema)
    .merge(linksSchema)
    .merge(reviewSchema)
    .merge(botDetectionSchema)
)

export function getFullSubmissionSchema(t: Translator) {
  return requireProductType(
    getBrandInfoSchema(t)
      .merge(getProductsSchema(t))
      .merge(getLinksSchema(t))
      .merge(getReviewSchema(t))
      .merge(getBotDetectionSchema(t))
  )
}

type FullSubmissionSchemaData = z.infer<typeof fullSubmissionSchema>

export type SubmissionFormData = Omit<
  FullSubmissionSchemaData,
  'productTypeNote' | 'productTypes' | 'valueTags'
> & {
  productTypeNote?: string
  productTypes?: string[]
  valueTags?: string[]
}
