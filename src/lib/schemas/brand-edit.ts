import { z } from 'zod'
import { getDuplicateRetailLocationIndex } from '@/lib/brands/locations'
import type { OnboardingStepKey } from '@/lib/services/brand-onboarding'

// --- Per-section Zod schemas ---

export const basicInfoSchema = z.object({
  name: z.string().optional(),
  productType: z.string().optional(),
  description: z.string().optional(),
  foundingYear: z.number().optional().or(z.string().optional()),
  mitStory: z.string().optional(),
  productTags: z.array(z.string().max(40)).max(5).optional(),
  city: z.string().optional(),
  priceRange: z.number().optional().or(z.string().optional()),
})

const mediaSchema = z.object({
  heroImageUrl: z.string().url().optional().or(z.literal('')),
  productPhotos: z.array(z.string().url()).max(6).optional(),
})

const linksSchema = z.object({
  socialInstagram: z.string().optional(),
  socialThreads: z.string().optional(),
  socialFacebook: z.string().url().optional().or(z.literal('')),
  purchaseWebsite: z.string().url().optional().or(z.literal('')),
  purchasePinkoi: z.string().url().optional().or(z.literal('')),
  purchaseShopee: z.string().url().optional().or(z.literal('')),
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

const reputationSchema = z.object({
  reputationSummary: z.string().optional(),
  reputationSources: z
    .array(
      z.object({
        url: z.string().url().or(z.literal('')),
      }),
    )
    .max(5)
    .optional(),
})

// Composed full schema (merge of all 5)
export const brandEditSchema = basicInfoSchema
  .merge(mediaSchema)
  .merge(linksSchema)
  .merge(locationsSchema)
  .merge(reputationSchema)

export const brandPublishRequirementsSchema = z.object({
  name: z.string().trim().min(1),
  productType: z.string().trim().min(1),
  description: z.string().trim().min(1),
  productTags: z.array(z.string().trim().min(1)).min(1).max(5),
  priceRange: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal('1'),
    z.literal('2'),
    z.literal('3'),
  ]),
  heroImageUrl: z.string().url(),
  productPhotos: z.array(z.string().url()).min(1).max(6),
  purchaseWebsite: z.string().url(),
})

export const brandPublishSchema = brandEditSchema.and(
  brandPublishRequirementsSchema,
)

export type BrandEditFormValues = z.infer<typeof brandEditSchema>

// --- Section field maps ---
export const SECTION_FIELDS: Record<string, (keyof BrandEditFormValues)[]> = {
  basicInfo: [
    'name',
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
  reputation: ['reputationSummary', 'reputationSources'],
}

// --- Wizard step definitions ---
type WizardStepKey =
  | 'basicInfo'
  | 'media'
  | 'links'
  | 'locations'
  | 'reputation'

export type WizardStep = { key: WizardStepKey }

export const WIZARD_STEPS: WizardStep[] = [
  { key: 'basicInfo' },
  { key: 'media' },
  { key: 'links' },
  { key: 'locations' },
  { key: 'reputation' },
]

// --- Onboarding step mappings ---
export function getOnboardingStepHref(
  key: OnboardingStepKey,
  slug: string,
): string {
  switch (key) {
    case 'brand_basics':
      return `/dashboard/brands/${slug}/edit?step=0`
    case 'media_links':
      return `/dashboard/brands/${slug}/edit?step=1`
    case 'analytics':
      return `/dashboard/brands/${slug}/analytics`
    case 'health':
      return `/dashboard/brands/${slug}#profile-completeness`
    case 'verification':
      return `/dashboard/brands/${slug}#verification`
  }
}

export const SECTION_TO_ONBOARDING_STEPS: Record<string, OnboardingStepKey[]> =
  {
    basicInfo: ['brand_basics'],
    media: ['media_links'],
    links: ['media_links'],
  }
