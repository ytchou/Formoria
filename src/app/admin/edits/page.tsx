import type { Metadata } from 'next'
import { getPendingEditCount, getPendingEdits } from '@/lib/services/pending-edits'
import { getModerationFlagsBatch } from '@/lib/services/moderation'
import type { ModerationFlag, RiskLevel } from '@/lib/services/moderation'
import { PendingEditsList } from '@/components/admin/pending-edits-list'

export const metadata: Metadata = {
  title: 'Brand Edit Review | Admin',
}

function getRiskLevel(flags: ModerationFlag[]): RiskLevel {
  if (flags.some((flag) => flag.tier === 'block')) return 'high'
  if (flags.some((flag) => flag.tier === 'flag')) return 'medium'
  return 'clean'
}

export default async function ReviewQueueEditsPage() {
  const [edits, count] = await Promise.all([
    getPendingEdits('pending'),
    getPendingEditCount(),
  ])
  const moderationFlagsByBrandId = await getModerationFlagsBatch(
    edits.map((edit) => edit.brandId)
  )
  const editsWithRisk = edits.map((edit) => ({
    ...edit,
    moderationRiskLevel: getRiskLevel(moderationFlagsByBrandId.get(edit.brandId) ?? []),
  }))

  return (
    <div>
      <h1 className="type-page-title-large">
        Brand Edit Review
      </h1>
      <p className="mt-2 text-warm-caption">
        Pending: {count}
      </p>

      <div className="mt-8">
        <PendingEditsList edits={editsWithRisk} />
      </div>
    </div>
  )
}
