import type { Metadata } from 'next'
import { getSubmissions } from '@/lib/services/submissions'
import { getModerationFlagsBatch } from '@/lib/services/moderation'
import type { ModerationFlag, RiskLevel } from '@/lib/services/moderation'
import { SubmissionsList } from '@/components/admin/submissions-list'

export const metadata: Metadata = {
  title: '待審核提交 | 管理後台',
}

function getRiskLevel(flags: ModerationFlag[]): RiskLevel {
  if (flags.some((flag) => flag.tier === 'tier1')) return 'high'
  if (flags.some((flag) => flag.tier === 'tier2')) return 'medium'
  return 'clean'
}

export default async function SubmissionsPage() {
  const submissions = await getSubmissions()
  const moderationFlagsByBrandId = await getModerationFlagsBatch(
    submissions
      .map((submission) => submission.brandId)
      .filter((brandId): brandId is string => Boolean(brandId))
  )
  const submissionsWithRisk = submissions.map((submission) => ({
    ...submission,
    moderationRiskLevel: getRiskLevel(
      submission.brandId ? moderationFlagsByBrandId.get(submission.brandId) ?? [] : []
    ),
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
        <SubmissionsList submissions={submissionsWithRisk} />
      </div>
    </div>
  )
}
