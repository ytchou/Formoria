import { z } from 'zod'
import type { OnboardingStepKey } from '@/lib/services/brand-onboarding'
import {
  BRAND_WIZARD_SHARED_SECTION_FIELDS,
  brandWizardBasicInfoSchema,
  brandWizardCommonSchema,
} from '@/lib/schemas/brand-wizard'

// --- Per-section Zod schemas ---

export const basicInfoSchema = brandWizardBasicInfoSchema

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
export const brandEditSchema = brandWizardCommonSchema.merge(reputationSchema)

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
  basicInfo: BRAND_WIZARD_SHARED_SECTION_FIELDS.basicInfo,
  media: BRAND_WIZARD_SHARED_SECTION_FIELDS.media,
  links: BRAND_WIZARD_SHARED_SECTION_FIELDS.links,
  locations: BRAND_WIZARD_SHARED_SECTION_FIELDS.locations,
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
