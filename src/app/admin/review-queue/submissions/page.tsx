import type { Metadata } from 'next'
import {
  submissionToDomain,
  type BrandSubmissionWithProductTypeNote,
} from '@/lib/services/submissions'
import { getModerationFlagsBatch } from '@/lib/services/moderation'
import type { ModerationFlag, RiskLevel } from '@/lib/services/moderation'
import { getBrandSlugsBatch } from '@/lib/services/brands'
import { getTags } from '@/lib/services/taxonomy'
import { createServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import type { EnrichedData } from '@/lib/types/enriched-data'
import { SubmissionsReviewList } from './submissions-review-list'

export const metadata: Metadata = {
  title: '待審核提交 | 管理後台',
}

type SubmissionRow = Database['public']['Tables']['brand_submissions']['Row']
type SubmissionDomainInput = Parameters<typeof submissionToDomain>[0]

type BrandSubmissionWithEnrichedData = BrandSubmissionWithProductTypeNote & {
  enriched_data: EnrichedData | null
}

const ADMIN_REVIEW_SUBMISSIONS_SELECT = `
  id,
  brand_id,
  brand_name,
  submitter_email,
  submitter_name,
  description,
  website_url,
  social_instagram,
  social_threads,
  social_facebook,
  purchase_website,
  purchase_pinkoi,
  purchase_shopee,
  other_urls,
  suggested_tags,
  status,
  reviewer_notes,
  submitted_at,
  reviewed_at,
  reviewed_by,
  pdpa_consent_at,
  validation_status,
  validation_errors,
  notified_at,
  is_brand_owner,
  source_attribution,
  product_type_note,
  enriched_data
`

function isEnrichedData(value: unknown): value is EnrichedData {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getRiskLevel(flags: ModerationFlag[]): RiskLevel {
  if (flags.some((flag) => flag.tier === 'block')) return 'high'
  if (flags.some((flag) => flag.tier === 'flag')) return 'medium'
  return 'clean'
}

async function getSubmissionsWithEnrichedData(): Promise<BrandSubmissionWithEnrichedData[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_submissions')
    .select(ADMIN_REVIEW_SUBMISSIONS_SELECT)
    .order('submitted_at', { ascending: false })

  if (error) throw error

  return ((data ?? []) as SubmissionRow[]).map((row) => ({
    ...submissionToDomain(row as SubmissionDomainInput),
    enriched_data: isEnrichedData(row.enriched_data) ? row.enriched_data : null,
  }))
}

export default async function ReviewQueueSubmissionsPage() {
  const submissions = await getSubmissionsWithEnrichedData()
  const brandIds = submissions
    .map((submission) => submission.brandId)
    .filter((brandId): brandId is string => Boolean(brandId))

  const moderationFlagsByBrandId = await getModerationFlagsBatch(brandIds)
  const [taxonomyTags, slugMap] = await Promise.all([
    getTags(),
    getBrandSlugsBatch(brandIds),
  ])

  const submissionsWithRisk = submissions.map((submission) => ({
    ...submission,
    moderationRiskLevel: getRiskLevel(
      submission.brandId ? moderationFlagsByBrandId.get(submission.brandId) ?? [] : []
    ),
    enriched_data: submission.enriched_data,
    brandSlug: slugMap.get(submission.brandId ?? '') ?? null,
  }))

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Submissions
      </h1>
      <p className="mt-2 text-[#7C7570]">
        Review and manage brand submissions.
      </p>

      <div className="mt-8">
        <SubmissionsReviewList
          submissions={submissionsWithRisk}
          taxonomyTags={taxonomyTags}
        />
      </div>
    </div>
  )
}
