import { z } from 'zod'
import type { OnboardingStepKey } from '@/lib/services/brand-onboarding'

// --- Per-section Zod schemas ---

export const basicInfoSchema = z.object({
  name: z.string().min(1),
  productType: z.string().min(1),
  description: z.string().optional(),
  foundingYear: z.number().optional().or(z.string().optional()),
  mitStory: z.string().optional(),
  productTags: z.array(z.string().max(40)).max(5).optional(),
  city: z.string().optional(),
  priceRange: z.number().optional().or(z.string().optional()),
})

export const mediaSchema = z.object({
  heroImageUrl: z.string().url().optional().or(z.literal('')),
  productPhotos: z.array(z.string()).max(6).optional(),
})

export const linksSchema = z.object({
  socialInstagram: z.string().optional(),
  socialThreads: z.string().optional(),
  socialFacebook: z.string().url().optional().or(z.literal('')),
  purchaseWebsite: z.string().url().optional().or(z.literal('')),
  purchasePinkoi: z.string().url().optional().or(z.literal('')),
  purchaseShopee: z.string().url().optional().or(z.literal('')),
  otherUrls: z.array(z.object({
    label: z.string().optional(),
    url: z.string().url().or(z.literal('')),
  })).optional(),
})

export const customerVoicesSchema = z.object({
  customerVoices: z.array(z.object({
    author: z.string(),
    content: z.string(),
    source: z.string().optional(),
  })).max(5).optional(),
})

export const locationsSchema = z.object({
  retailLocations: z.array(z.object({
    name: z.string(),
    address: z.string().optional(),
  })).optional(),
})

export const reputationSchema = z.object({
  reputationSummary: z.string().optional(),
  reputationSources: z.array(z.object({
    url: z.string().url().or(z.literal('')),
    title: z.string().optional(),
    retrievedAt: z.string().optional(),
  })).max(5).optional(),
})

export const manufacturingSchema = z.object({
  factoryLocation: z.string().optional(),
  productionModel: z.string().optional(),
  manufacturingNotes: z.string().optional(),
})

export const certificationsSchema = z.object({
  certifications: z.array(z.object({
    name: z.string(),
    issuer: z.string().optional(),
    year: z.number().optional().or(z.string().optional()),
    sourceUrl: z.string().url().optional().or(z.literal('')),
  })).max(10).optional(),
})

export const policiesSchema = z.object({
  returnsPolicy: z.string().optional(),
  warranty: z.string().optional(),
  shipsInternational: z.boolean().optional(),
})

// Composed full schema (merge of all 9)
export const brandEditSchema = basicInfoSchema
  .merge(mediaSchema)
  .merge(linksSchema)
  .merge(customerVoicesSchema)
  .merge(locationsSchema)
  .merge(reputationSchema)
  .merge(manufacturingSchema)
  .merge(certificationsSchema)
  .merge(policiesSchema)

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
  customerVoices: ['customerVoices'],
  locations: ['retailLocations'],
  reputation: ['reputationSummary', 'reputationSources'],
  manufacturing: ['factoryLocation', 'productionModel', 'manufacturingNotes'],
  certifications: ['certifications'],
  policies: ['returnsPolicy', 'warranty', 'shipsInternational'],
}

// --- Wizard step definitions ---
type WizardStepKey =
  | 'basicInfo'
  | 'media'
  | 'links'
  | 'customerVoices'
  | 'locations'
  | 'reputation'
  | 'manufacturing'
  | 'certifications'
  | 'policies'

export type WizardStep = { key: WizardStepKey }

export const WIZARD_STEPS: WizardStep[] = [
  { key: 'basicInfo' },
  { key: 'media' },
  { key: 'links' },
  { key: 'customerVoices' },
  { key: 'locations' },
  { key: 'reputation' },
  { key: 'manufacturing' },
  { key: 'certifications' },
  { key: 'policies' },
]

// --- Onboarding step mappings ---
export function getOnboardingStepHref(key: OnboardingStepKey, slug: string): string {
  switch (key) {
    case 'brand_basics':
      return `/dashboard/brands/${slug}/edit?step=0`
    case 'media_links':
      return `/dashboard/brands/${slug}/edit?step=1`
    case 'analytics':
      return `/dashboard/analytics?brand=${slug}`
    case 'health':
      return `/dashboard/health?brand=${slug}`
    case 'verification':
      return `/dashboard/verification?brand=${slug}`
  }
}

export const SECTION_TO_ONBOARDING_STEPS: Record<string, OnboardingStepKey[]> = {
  basicInfo: ['brand_basics'],
  media: ['media_links'],
  links: ['media_links'],
}
