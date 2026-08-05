import { z } from 'zod'
import { MAX_BRAND_GALLERY_PHOTOS } from '@/lib/constants/brand-images'
import { purchaseChannelByKey } from '@/lib/brands/purchase-channels'
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

// Composed full schema.
export const brandEditSchema = brandWizardCommonSchema.merge(reputationSchema)

const publishPurchaseRequirements = {
  [purchaseChannelByKey.website.camel]: z.string().url(),
}

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
  // Gallery photos are optional: a brand with only a hero image must still be
  // able to publish and to save unrelated fields in the edit wizard.
  productPhotos: z.array(z.string().url()).min(0).max(MAX_BRAND_GALLERY_PHOTOS),
  ...publishPurchaseRequirements,
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
  reputation: ['reputationSummary', 'reputationSources'],
}

// --- Wizard step definitions ---
type WizardStepKey =
  | 'basicInfo'
  | 'media'
  | 'links'
  | 'reputation'

export type WizardStep = { key: WizardStepKey }

export const WIZARD_STEPS: WizardStep[] = [
  { key: 'basicInfo' },
  { key: 'media' },
  { key: 'links' },
  { key: 'reputation' },
]

export function areAllWizardStepsComplete(
  completedSteps: Iterable<number>,
  totalSteps = WIZARD_STEPS.length,
): boolean {
  if (totalSteps <= 0) return false

  const completed = new Set(completedSteps)
  for (let step = 0; step < totalSteps; step += 1) {
    if (!completed.has(step)) return false
  }

  return true
}
