import type { Metadata } from 'next'
import { FeedbackList } from '@/components/admin/feedback-list'
import { getFeedbackItems } from '@/lib/services/feedback'

export const metadata: Metadata = { title: 'User Feedback | Formoria Admin' }

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
        <h1 className="type-section-title-large">User Feedback</h1>
        <p className="mt-1 type-body-muted">
          Manage user feedback and error reports from Sentry and Tally
        </p>
      </div>
      {items.length === 0 ? (
        <p className="type-body-muted">No feedback items.</p>
      ) : (
        <FeedbackList items={items} />
      )}
    </div>
  )
}
