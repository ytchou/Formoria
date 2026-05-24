import { z } from 'zod/v3'
import { SOURCE_ATTRIBUTION_VALUES } from '@/lib/types/submission'

export const scrapeUrlSchema = z.object({
  url: z.string().url().max(2048).startsWith('https://'),
})

const nameField = z.string().min(2, '品牌名稱至少需要 2 個字元').max(100)
const descriptionField = z.string().min(10, '品牌介紹至少需要 10 個字元').max(500)
const categoryField = z.string().min(1, '請選擇分類')
const tagsField = z.array(z.string()).max(5, '最多可選擇 5 個標籤')

export const brandInfoSchema = z.object({
  name: nameField,
  description: descriptionField,
  category: categoryField,
  tags: tagsField,
  logoUrl: z.string().url('請上傳品牌標誌').min(1, '請上傳品牌標誌'),
})

export const productsSchema = z.object({
  productPhotos: z.array(z.string()).max(6, '最多可上傳 6 張照片'),
  productHighlights: z.string().max(300),
})

const purchaseLinkSchema = z.object({
  platform: z.string().min(1, '請選擇平台'),
  url: z.string().url('請輸入有效的網址'),
})

const socialLinksSchema = z.object({
  instagram: z.string(),
  threads: z.string(),
  facebook: z.string(),
  website: z.string(),
})

const retailLocationSchema = z.object({
  name: z.string().min(1, '請輸入地點名稱'),
  address: z.string().min(1, '請輸入地址'),
})

export const linksSchema = z.object({
  purchaseLinks: z
    .array(purchaseLinkSchema)
    .min(1, '請提供至少一個購買連結'),
  socialLinks: socialLinksSchema,
  retailLocations: z.array(retailLocationSchema),
})

export const reviewSchema = z.object({
  pdpaConsent: z.boolean().refine((v) => v === true, {
    message: '請同意隱私政策',
  }),
})

export const botDetectionSchema = z.object({
  turnstileToken: z.string().min(1, '請完成驗證'),
  _honeypot: z.string().max(0).optional(),
})

const sourceAttributionEnum = z.enum(SOURCE_ATTRIBUTION_VALUES)

const ownerFields = z.object({
  isOwner: z.boolean(),
  sourceAttribution: sourceAttributionEnum.optional(),
})

/**
 * Schema factory for brand submission validation.
 * - isOwner=true: logoUrl and at least one purchaseLink are required
 * - isOwner=false: logoUrl and purchaseLinks are optional; sourceAttribution accepted
 */
export function createSubmissionSchema(isOwner: boolean) {
  const brandInfoBase = z.object({
    name: nameField,
    description: descriptionField,
    category: categoryField,
    tags: tagsField,
    logoUrl: isOwner
      ? z.string().url('請上傳品牌標誌').min(1, '請上傳品牌標誌')
      : z.string().url().optional().or(z.literal('')),
  })

  const linksBase = z.object({
    purchaseLinks: isOwner
      ? z.array(purchaseLinkSchema).min(1, '請提供至少一個購買連結')
      : z.array(purchaseLinkSchema).optional().default([]),
    socialLinks: socialLinksSchema,
    retailLocations: z.array(retailLocationSchema),
  })

  return brandInfoBase
    .merge(productsSchema)
    .merge(linksBase)
    .merge(reviewSchema)
    .merge(botDetectionSchema)
    .merge(ownerFields)
}

export { SOURCE_ATTRIBUTION_VALUES }

export const fullSubmissionSchema = brandInfoSchema
  .merge(productsSchema)
  .merge(linksSchema)
  .merge(reviewSchema)
  .merge(botDetectionSchema)

export type SubmissionFormData = z.infer<typeof fullSubmissionSchema>
