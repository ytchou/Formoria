import type { Metadata } from 'next'
import { getPendingEditCount, getPendingEdits } from '@/lib/services/pending-edits'
import { getModerationFlags } from '@/lib/services/moderation'
import type { ModerationFlag, RiskLevel } from '@/lib/services/moderation'
import { PendingEditsList } from '@/components/admin/pending-edits-list'

export const metadata: Metadata = {
  title: '品牌編輯審核 | 管理後台',
}

function getRiskLevel(flags: ModerationFlag[]): RiskLevel {
  if (flags.some((flag) => flag.tier === 'tier1')) return 'high'
  if (flags.some((flag) => flag.tier === 'tier2')) return 'medium'
  return 'clean'
}

export default async function PendingEditsPage() {
  const [edits, count] = await Promise.all([
    getPendingEdits('pending'),
    getPendingEditCount(),
  ])
  const moderationFlags = await Promise.all(
    edits.map((edit) => getModerationFlags(edit.brandId))
  )
  const editsWithRisk = edits.map((edit, index) => ({
    ...edit,
    moderationRiskLevel: getRiskLevel(moderationFlags[index] ?? []),
  }))

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        品牌編輯審核
      </h1>
      <p className="mt-2 text-warm-caption">
        待審核：{count} 件
      </p>

      <div className="mt-8">
        <PendingEditsList edits={editsWithRisk} />
      </div>
    </div>
  )
}
