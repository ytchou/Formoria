import { AdminSubNav } from '@/components/admin/admin-sub-nav'
import { getFlaggedContent } from '@/lib/services/moderation'
import { getPendingEdits } from '@/lib/services/pending-edits'
import { getSubmissions } from '@/lib/services/submissions'

type ReviewQueueLayoutProps = {
  children: React.ReactNode
}

export default async function ReviewQueueLayout({
  children,
}: ReviewQueueLayoutProps) {
  const [submissions, flaggedContent, edits] = await Promise.all([
    getSubmissions(),
    getFlaggedContent({ status: 'pending' }),
    getPendingEdits('pending'),
  ])

  const tabs = [
    {
      label: '待審核提交',
      href: '/admin/review-queue/submissions',
      count: submissions.length,
    },
    {
      label: '內容審核',
      href: '/admin/review-queue/moderation',
      count: flaggedContent.items.length,
    },
    {
      label: '品牌編輯審核',
      href: '/admin/review-queue/edits',
      count: edits.length,
    },
  ]

  return (
    <>
      <AdminSubNav tabs={tabs} />
      {children}
    </>
  )
}
