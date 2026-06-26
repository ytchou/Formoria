import type { Metadata } from 'next'
import { getSubmissions } from '@/lib/services/submissions'
import { getModerationFlagsBatch } from '@/lib/services/moderation'
import type { ModerationFlag, RiskLevel } from '@/lib/services/moderation'
import { getBrandEnrichmentBatch, getBrandSlugsBatch } from '@/lib/services/brands'
import { getTags } from '@/lib/services/taxonomy'
import { SubmissionsReviewList } from './submissions-review-list'

export const metadata: Metadata = {
  title: '待審核提交 | 管理後台',
}

function getRiskLevel(flags: ModerationFlag[]): RiskLevel {
  if (flags.some((flag) => flag.tier === 'block')) return 'high'
  if (flags.some((flag) => flag.tier === 'flag')) return 'medium'
  return 'clean'
}

export default async function ReviewQueueSubmissionsPage() {
  const submissions = await getSubmissions()
  const brandIds = submissions
    .map((submission) => submission.brandId)
    .filter((brandId): brandId is string => Boolean(brandId))

  const moderationFlagsByBrandId = await getModerationFlagsBatch(brandIds)
  const [brandEnrichmentById, taxonomyTags, slugMap] = await Promise.all([
    getBrandEnrichmentBatch(brandIds),
    getTags(),
    getBrandSlugsBatch(brandIds),
  ])

  const submissionsWithRisk = submissions.map((submission) => ({
    ...submission,
    moderationRiskLevel: getRiskLevel(
      submission.brandId ? moderationFlagsByBrandId.get(submission.brandId) ?? [] : []
    ),
    brandEnrichment: submission.brandId
      ? brandEnrichmentById.get(submission.brandId) ?? null
      : null,
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
