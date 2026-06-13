import type { Metadata } from 'next'
import { FeedbackList } from '@/components/admin/feedback-list'
import { getFeedbackItems } from '@/lib/services/feedback'

export const metadata: Metadata = { title: '用戶回饋 | Formoria Admin' }

export default async function FeedbackPage() {
  let items: Awaited<ReturnType<typeof getFeedbackItems>> = []
  try {
    items = await getFeedbackItems()
  } catch (err) {
    console.error('[admin:feedback]', err)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold">用戶回饋</h1>
        <p className="mt-1 text-muted-foreground">
          管理來自 Sentry 和 Tally 的用戶回饋與錯誤報告
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground">目前沒有回饋項目。</p>
      ) : (
        <FeedbackList items={items} />
      )}
    </div>
  )
}
