import { z } from 'zod'
import { getDuplicateRetailLocationIndex } from '@/lib/brands/locations'

const basicInfoSchema = z.object({
  name: z.string().min(1),
  website: z.string().url(),
  description: z.string().min(1),
  productType: z.string().optional(),
  foundingYear: z.union([z.number(), z.string()]).optional(),
  productTags: z.array(z.string().max(40)).max(5).optional(),
  city: z.string().optional(),
  priceRange: z.union([z.number(), z.string()]).optional(),
  mitStory: z.string().optional(),
})

const optionalUrlSchema = z.string().url().or(z.literal('')).optional()

const mediaSchema = z.object({
  heroImageUrl: optionalUrlSchema,
  productPhotos: z.array(z.string().url()).max(6).optional(),
})

const linksSchema = z.object({
  socialInstagram: optionalUrlSchema,
  socialThreads: optionalUrlSchema,
  socialFacebook: optionalUrlSchema,
  purchaseWebsite: optionalUrlSchema,
  purchasePinkoi: optionalUrlSchema,
  purchaseShopee: optionalUrlSchema,
  otherUrls: z
    .array(
      z.object({
        label: z.string().optional(),
        url: z.string().url().or(z.literal('')),
      }),
    )
    .optional(),
})

const optionalLocationNumberSchema = z.union([z.number(), z.string()]).optional()

const retailLocationSchema = z
  .object({
    name: z.string().optional(),
    relationshipType: z
      .enum(['brand_store', 'stockist', 'department_counter'])
      .optional(),
    type: z.enum(['chain', 'independent']).optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    district: z.string().optional(),
    venueName: z.string().optional(),
    floorOrCounter: z.string().optional(),
    availabilityNote: z.string().optional(),
    latitude: optionalLocationNumberSchema,
    longitude: optionalLocationNumberSchema,
    verificationStatus: z.enum(['verified', 'manual', 'needs_review']).optional(),
  })
  .superRefine((location, ctx) => {
    const hasLocationValue = Object.values(location).some((value) =>
      typeof value === 'string' ? value.trim().length > 0 : value !== undefined,
    )
    if (hasLocationValue && !location.address?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['address'],
        message: 'Address is required',
      })
    }
  })

const locationsSchema = z.object({
  retailLocations: z
    .array(retailLocationSchema)
    .superRefine((locations, ctx) => {
      const duplicateIndex = getDuplicateRetailLocationIndex(locations)
      if (duplicateIndex === undefined) return

      ctx.addIssue({
        code: 'custom',
        path: [duplicateIndex, 'address'],
        message: 'Duplicate retail location',
      })
    })
    .optional(),
})

export const submissionWizardSchema = basicInfoSchema
  .merge(mediaSchema)
  .merge(linksSchema)
  .merge(locationsSchema)

export const submissionWizardRequiredSchema = submissionWizardSchema.and(
  z.object({
    heroImageUrl: z.string().url(),
  }),
)

export type SubmissionWizardFormValues = z.infer<
  typeof submissionWizardSchema
>

export type SubmissionWizardStepKey =
  | 'basicInfo'
  | 'media'
  | 'links'
  | 'locations'

export const SUBMISSION_SECTION_FIELDS: Record<
  SubmissionWizardStepKey,
  (keyof SubmissionWizardFormValues)[]
> = {
  basicInfo: [
    'name',
    'website',
    'description',
    'productType',
    'foundingYear',
    'productTags',
    'city',
    'priceRange',
    'mitStory',
  ],
  media: ['heroImageUrl', 'productPhotos'],
  links: [
    'socialInstagram',
    'socialThreads',
    'socialFacebook',
    'purchaseWebsite',
    'purchasePinkoi',
    'purchaseShopee',
    'otherUrls',
  ],
  locations: ['retailLocations'],
}

export const SUBMISSION_WIZARD_STEPS: {
  key: SubmissionWizardStepKey
}[] = [
  { key: 'basicInfo' },
  { key: 'media' },
  { key: 'links' },
  { key: 'locations' },
]
