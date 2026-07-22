import { z } from 'zod'
import { getDuplicateRetailLocationIndex } from '@/lib/brands/locations'

export const romanizedNameSchema = z
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
  productType: z.string().optional(),
  description: z.string().optional(),
  foundingYear: z.union([z.number(), z.string()]).optional(),
  mitStory: z.string().optional(),
  productTags: z.array(z.string().max(40)).max(5).optional(),
  city: z.string().optional(),
  priceRange: z.union([z.number(), z.string()]).optional(),
})

const brandWizardMediaSchema = z.object({
  heroImageUrl: optionalUrlSchema,
  productPhotos: z.array(z.string().url()).max(6).optional(),
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

const brandWizardLinksSchema = z.object({
  socialInstagram: socialHandleOrUrlSchema,
  socialThreads: socialHandleOrUrlSchema,
  socialFacebook: optionalUrlSchema,
  purchaseWebsite: optionalUrlSchema,
  purchasePinkoi: optionalUrlSchema,
  purchaseShopee: optionalUrlSchema,
  otherUrls: z.array(otherUrlSchema).optional(),
})

const optionalLocationNumberSchema = z.union([z.number(), z.string()]).optional()

const retailLocationSchema = z
  .object({
    kind: z.enum(['location', 'retail_chain']).optional(),
    name: z.string().optional(),
    relationshipType: z.enum(['brand_store', 'stockist', 'department_counter']).optional(),
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
    confirmationStatus: z.enum(['unconfirmed', 'owner_confirmed']).optional(),
    retailerUrl: z.string().optional(),
  })
  .superRefine((location, context) => {
    const hasValue = (value: unknown) =>
      typeof value === 'string'
        ? value.trim().length > 0
        : value !== undefined
    const hasMeaningfulValue = [
      location.name,
      location.type,
      location.address,
      location.city,
      location.district,
      location.venueName,
      location.floorOrCounter,
      location.availabilityNote,
      location.latitude,
      location.longitude,
      location.retailerUrl,
      location.confirmationStatus === 'owner_confirmed'
        ? location.confirmationStatus
        : undefined,
    ].some(hasValue)

    if (hasMeaningfulValue && !location.name?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Name is required',
      })
    }

    if (
      location.kind === 'location' &&
      location.confirmationStatus === 'owner_confirmed' &&
      !location.address?.trim()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['address'],
        message: 'Address is required for owner confirmation',
      })
    }

    if (location.kind === 'retail_chain') {
      const retailerUrl = location.retailerUrl?.trim()
      if (retailerUrl) {
        try {
          const url = new URL(retailerUrl)
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('Unsupported protocol')
          }
        } catch {
          context.addIssue({
            code: 'custom',
            path: ['retailerUrl'],
            message: 'Retailer URL must use HTTP(S)',
          })
        }
      }

      const locationOnlyFields: Array<{ field: string; value: unknown }> = [
        { field: 'relationshipType', value: location.relationshipType },
        { field: 'type', value: location.type },
        { field: 'address', value: location.address },
        { field: 'city', value: location.city },
        { field: 'district', value: location.district },
        { field: 'venueName', value: location.venueName },
        { field: 'floorOrCounter', value: location.floorOrCounter },
        { field: 'latitude', value: location.latitude },
        { field: 'longitude', value: location.longitude },
        { field: 'verificationStatus', value: location.verificationStatus },
        { field: 'confirmationStatus', value: location.confirmationStatus },
      ]
      const locationOnlyField = locationOnlyFields.find(({ value }) =>
        hasValue(value),
      )
      if (locationOnlyField) {
        context.addIssue({
          code: 'custom',
          path: [locationOnlyField.field],
          message: 'Retail chains cannot include physical location data',
        })
      }
    }

    if (location.kind === 'location' && hasValue(location.retailerUrl)) {
      context.addIssue({
        code: 'custom',
        path: ['retailerUrl'],
        message: 'Physical locations cannot include a retailer URL',
      })
    }
  })

const brandWizardLocationsSchema = z.object({
  retailLocations: z
    .array(retailLocationSchema)
    .superRefine((locations, context) => {
      const duplicateIndex = getDuplicateRetailLocationIndex(locations)
      if (duplicateIndex === undefined) return
      const duplicate = locations.at(duplicateIndex)
      context.addIssue({
        code: 'custom',
        path: [
          duplicateIndex,
          duplicate?.kind === 'retail_chain' ? 'name' : 'address',
        ],
        message: 'Duplicate retail location',
      })
    })
    .optional(),
})

export const brandWizardCommonSchema = brandWizardBasicInfoSchema
  .merge(brandWizardMediaSchema)
  .merge(brandWizardLinksSchema)
  .merge(brandWizardLocationsSchema)

export type BrandWizardCommonValues = z.infer<typeof brandWizardCommonSchema>
export type BrandWizardSharedStepKey = 'basicInfo' | 'media' | 'links' | 'locations'

export const BRAND_WIZARD_SHARED_SECTION_FIELDS: Record<
  BrandWizardSharedStepKey,
  (keyof BrandWizardCommonValues)[]
> = {
  basicInfo: [
    'name',
    'romanizedName',
    'productType',
    'description',
    'foundingYear',
    'mitStory',
    'productTags',
    'city',
    'priceRange',
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
