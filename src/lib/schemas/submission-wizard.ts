import { z } from 'zod'
import {
  BRAND_WIZARD_SHARED_SECTION_FIELDS,
  brandWizardCommonSchema,
} from '@/lib/schemas/brand-wizard'

export const submissionWizardSchema = brandWizardCommonSchema.extend({
  name: z.string().min(1),
  website: z.string().url(),
  description: z.string().min(1),
})

export const submissionWizardRequiredSchema = submissionWizardSchema.extend({
  heroImageUrl: z.string().url(),
})

export type SubmissionWizardFormValues = z.infer<typeof submissionWizardSchema>
export type SubmissionWizardStepKey =
  | 'basicInfo'
  | 'media'
  | 'links'

export const SUBMISSION_SECTION_FIELDS: Record<
  SubmissionWizardStepKey,
  (keyof SubmissionWizardFormValues)[]
> = {
  basicInfo: [...BRAND_WIZARD_SHARED_SECTION_FIELDS.basicInfo, 'website'],
  media: BRAND_WIZARD_SHARED_SECTION_FIELDS.media,
  links: BRAND_WIZARD_SHARED_SECTION_FIELDS.links,
}

export const SUBMISSION_WIZARD_STEPS: { key: SubmissionWizardStepKey }[] = [
  { key: 'basicInfo' },
  { key: 'media' },
  { key: 'links' },
]
