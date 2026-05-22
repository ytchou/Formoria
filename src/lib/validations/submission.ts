import { z } from 'zod/v3'

export const scrapeUrlSchema = z.object({
  url: z.string().url().max(2048).startsWith('https://'),
})

export const brandInfoSchema = z.object({
  name: z.string().min(2, 'Brand name must be at least 2 characters').max(100),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(500),
  category: z.string().min(1, 'Please select a category'),
  tags: z.array(z.string()).max(5, 'Maximum 5 tags allowed'),
  logoUrl: z.string().url('Please upload a logo').min(1, 'Please upload a logo'),
})

export const productsSchema = z.object({
  productPhotos: z.array(z.string()).max(6, 'Maximum 6 photos allowed'),
  productHighlights: z.string().max(300),
})

const purchaseLinkSchema = z.object({
  platform: z.string().min(1, 'Please select a platform'),
  url: z.string().url('Please enter a valid URL'),
})

const socialLinksSchema = z.object({
  instagram: z.string(),
  threads: z.string(),
  facebook: z.string(),
  website: z.string(),
})

const retailLocationSchema = z.object({
  name: z.string().min(1, 'Location name is required'),
  address: z.string().min(1, 'Address is required'),
})

export const linksSchema = z.object({
  purchaseLinks: z
    .array(purchaseLinkSchema)
    .min(1, 'At least one purchase link is required'),
  socialLinks: socialLinksSchema,
  retailLocations: z.array(retailLocationSchema),
})

export const reviewSchema = z.object({
  pdpaConsent: z.boolean().refine((v) => v === true, {
    message: 'You must agree to the privacy policy',
  }),
})

export const botDetectionSchema = z.object({
  turnstileToken: z.string().min(1, 'Please complete the verification'),
  _honeypot: z.string().max(0).optional(),
})

export const fullSubmissionSchema = brandInfoSchema
  .merge(productsSchema)
  .merge(linksSchema)
  .merge(reviewSchema)
  .merge(botDetectionSchema)

export type SubmissionFormData = z.infer<typeof fullSubmissionSchema>
