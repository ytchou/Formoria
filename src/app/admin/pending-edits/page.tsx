import type { Metadata } from 'next'
import { getPendingEditCount, getPendingEdits } from '@/lib/services/pending-edits'
import { PendingEditsList } from '@/components/admin/pending-edits-list'

export const metadata: Metadata = {
  title: '品牌編輯審核 | 管理後台',
}

export default async function PendingEditsPage() {
  const [edits, count] = await Promise.all([
    getPendingEdits('pending'),
    getPendingEditCount(),
  ])

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        品牌編輯審核
      </h1>
      <p className="mt-2 text-warm-caption">
        待審核：{count} 件
      </p>

      <div className="mt-8">
        <PendingEditsList edits={edits} />
      </div>
    </div>
  )
}
