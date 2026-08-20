import { z } from 'zod'
import { MAX_BRAND_GALLERY_PHOTOS } from '@/lib/constants/brand-images'
import { isKnownSubcategoryTerm } from '@/lib/taxonomy/ontology'
import {
  ONLINE_STORE_CAMEL_FIELDS,
  ONLINE_STORES,
  type OnlineStoreCamelField,
} from '@/lib/brands/online-stores'

const romanizedNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[a-zA-Z0-9\s\-'.]+$/)
  .optional()
  .or(z.literal(''))

const optionalUrlSchema = z.string().url().optional().or(z.literal(''))
const socialHandlePattern = /^@?[a-zA-Z0-9][a-zA-Z0-9._-]*$/

const socialHandleOrUrlSchema = z
  .string()
  .trim()
  .refine((value) => {
    if (!value || socialHandlePattern.test(value)) return true
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }, 'Enter a profile handle or URL')
  .optional()

export const brandWizardBasicInfoSchema = z.object({
  name: z.string().optional(),
  romanizedName: romanizedNameSchema,
  categorySlug: z.string().optional(),
  description: z.string().optional(),
  foundingYear: z.union([z.number(), z.string()]).optional(),
  mitStory: z.string().optional(),
  // Closed vocabulary since DEV-1510: the wizard's picker can only emit stored
  // slugs, so anything else reached this schema by bypassing the UI. Membership
  // is asked on both bases because a pre-migration draft still carries labels.
  subcategories: z
    .array(z.string().max(100))
    .max(5)
    .refine((values) => values.every(isKnownSubcategoryTerm), {
      message: 'Choose subcategories from the list',
    })
    .optional(),
  city: z.string().optional(),
  priceRange: z.union([z.number(), z.string()]).optional(),
})

const brandWizardMediaSchema = z.object({
  heroImageUrl: optionalUrlSchema,
  productPhotos: z
    .array(z.string().url())
    .max(MAX_BRAND_GALLERY_PHOTOS)
    .optional(),
})

const otherUrlSchema = z
  .object({
    label: z.string().optional(),
    url: optionalUrlSchema,
  })
  .superRefine((value, context) => {
    const hasLabel = Boolean(value.label?.trim())
    const hasUrl = Boolean(value.url?.trim())
    if (hasLabel === hasUrl) return
    context.addIssue({
      code: 'custom',
      path: hasLabel ? ['url'] : ['label'],
      message: 'Complete both the label and URL',
    })
  })

const purchaseUrlSchemas = Object.fromEntries(
  ONLINE_STORES.map((channel) => [channel.camel, optionalUrlSchema]),
) as { [Field in OnlineStoreCamelField]: typeof optionalUrlSchema }

const brandWizardLinksSchema = z.object({
  socialInstagram: socialHandleOrUrlSchema,
  socialThreads: socialHandleOrUrlSchema,
  socialFacebook: optionalUrlSchema,
  ...purchaseUrlSchemas,
  otherUrls: z.array(otherUrlSchema).optional(),
})

export const brandWizardCommonSchema = brandWizardBasicInfoSchema
  .merge(brandWizardMediaSchema)
  .merge(brandWizardLinksSchema)

export type BrandWizardCommonValues = z.infer<typeof brandWizardCommonSchema>
export type BrandWizardSharedStepKey = 'basicInfo' | 'media' | 'links'

export const BRAND_WIZARD_SHARED_SECTION_FIELDS: Record<
  BrandWizardSharedStepKey,
  (keyof BrandWizardCommonValues)[]
> = {
  basicInfo: [
    'name',
    'romanizedName',
    'categorySlug',
    'description',
    'foundingYear',
    'mitStory',
    'subcategories',
    'city',
    'priceRange',
  ],
  media: ['heroImageUrl', 'productPhotos'],
  links: [
    'socialInstagram',
    'socialThreads',
    'socialFacebook',
    ...ONLINE_STORE_CAMEL_FIELDS,
    'otherUrls',
  ],
}
