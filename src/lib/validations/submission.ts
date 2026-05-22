import { z } from 'zod/v3'

export const scrapeUrlSchema = z.object({
  url: z.string().url().max(2048).startsWith('https://'),
})

export const brandInfoSchema = z.object({
  name: z.string().min(2, '品牌名稱至少需要 2 個字元').max(100),
  description: z
    .string()
    .min(10, '品牌介紹至少需要 10 個字元')
    .max(500),
  category: z.string().min(1, '請選擇分類'),
  tags: z.array(z.string()).max(5, '最多可選擇 5 個標籤'),
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

export const fullSubmissionSchema = brandInfoSchema
  .merge(productsSchema)
  .merge(linksSchema)
  .merge(reviewSchema)
  .merge(botDetectionSchema)

export type SubmissionFormData = z.infer<typeof fullSubmissionSchema>
