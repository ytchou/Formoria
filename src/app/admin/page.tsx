import {
  approveClaimAction,
  approvePendingEditAction,
  approveSubmissionAction,
  reviewFeedbackAction,
  reviewReportAction,
} from '@/app/admin/actions'
import { DashboardQueueItem } from '@/components/admin/dashboard-queue-item'
import { NewsletterSubscribersList } from '@/components/admin/newsletter-subscribers'
import { QueueSummaryCard } from '@/components/admin/queue-summary-card'
import { SystemStatusCard } from '@/components/admin/system-status-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getBrands } from '@/lib/services/brands'
import { listClaimRequests } from '@/lib/services/claim-requests'
import { getFeedbackItems } from '@/lib/services/feedback'
import { checkAllServices, type ServiceHealthResult } from '@/lib/services/health-checks'
import { getFlaggedContent } from '@/lib/services/moderation'
import { getSubscribers, getSubscriberStats } from '@/lib/services/newsletter'
import { getPendingEdits } from '@/lib/services/pending-edits'
import { getPendingReports } from '@/lib/services/reports'
import { getSubmissions } from '@/lib/services/submissions'
import { getTags } from '@/lib/services/taxonomy'
import { createServiceClient } from '@/lib/supabase/server'

type QueueItem = {
  id: string
  label: string
  sublabel?: string
  date: string
  riskLevel?: 'high' | 'medium' | 'clean'
  action: () => Promise<unknown>
}

type ReviewQueue = {
  key: string
  title: string
  count: number
  href: string
  emptyMessage: string
  items: QueueItem[]
}

function formatQueueDate(value: string | null | undefined): string {
  if (!value) return '未記錄'
  return value.slice(0, 10)
}

async function getNewsletterDashboardData() {
  try {
    const supabase = createServiceClient()
    const [subscribers, subscriberStats] = await Promise.all([
      getSubscribers(supabase),
      getSubscriberStats(supabase),
    ])

    return { subscribers, subscriberStats }
  } catch {
    return {
      subscribers: [],
      subscriberStats: {
        total: 0,
        confirmed: 0,
        unsubscribed: 0,
      },
    }
  }
}

export default async function AdminPage() {
  const [
    submissions,
    pendingEdits,
    claimRequests,
    reports,
    feedbackItems,
    flaggedContentResult,
    brandResult,
    tags,
    healthResults,
    newsletterData,
  ] = await Promise.all([
    getSubmissions('pending', { limit: 5 }).catch(() => []),
    getPendingEdits('pending', { limit: 5 }).catch(() => []),
    listClaimRequests('pending', { limit: 5 }).catch(() => []),
    getPendingReports({ limit: 5 }).catch(() => []),
    getFeedbackItems({ status: 'open', limit: 5 }).catch(() => []),
    getFlaggedContent({ status: 'pending', limit: 5 }).catch(() => ({
      items: [],
      nextCursor: null,
    })),
    getBrands({ includeTestBrands: true, limit: 5 }).catch(() => ({
      brands: [],
      totalCount: 0,
    })),
    getTags().catch(() => []),
    checkAllServices().catch((): ServiceHealthResult[] => []),
    getNewsletterDashboardData(),
  ])

  const flaggedContent = flaggedContentResult.items
  const { subscribers, subscriberStats } = newsletterData
  const activeTagCount = tags.filter((tag) => tag.isActive).length

  const queues: ReviewQueue[] = [
    {
      key: 'submissions',
      title: '新品牌提交',
      count: submissions.length,
      href: '/admin/review-queue/submissions',
      emptyMessage: '目前沒有待審核的新品牌提交。',
      items: submissions.map((submission) => ({
        id: submission.id,
        label: submission.brandName,
        sublabel: submission.submitterEmail,
        date: formatQueueDate(submission.submittedAt),
        riskLevel: submission.validationStatus === 'incomplete' ? 'medium' as const : undefined,
        action: approveSubmissionAction.bind(null, submission.id),
      })),
    },
    {
      key: 'edits',
      title: '品牌編輯',
      count: pendingEdits.length,
      href: '/admin/review-queue/edits',
      emptyMessage: '目前沒有待審核的品牌編輯。',
      items: pendingEdits.map((edit) => ({
        id: edit.id,
        label: edit.brand.name || edit.brandId,
        sublabel: edit.brand.contactEmail ?? edit.submittedBy,
        date: formatQueueDate(edit.createdAt),
        action: approvePendingEditAction.bind(null, edit.id),
      })),
    },
    {
      key: 'claims',
      title: '品牌認領',
      count: claimRequests.length,
      href: '/admin/claims',
      emptyMessage: '目前沒有待審核的品牌認領。',
      items: claimRequests.map((claim) => ({
        id: claim.id,
        label: claim.brandName ?? claim.brandId,
        sublabel: claim.requesterEmail ?? claim.proofUrl ?? claim.userId,
        date: formatQueueDate(claim.createdAt),
        action: approveClaimAction.bind(null, claim.id),
      })),
    },
    {
      key: 'reports',
      title: '品牌檢舉',
      count: reports.length,
      href: '/admin/signals/reports',
      emptyMessage: '目前沒有待審核的品牌檢舉。',
      items: reports.map((report) => ({
        id: report.id,
        label: report.brandName ?? report.brandId,
        sublabel: report.notes ?? report.reason,
        date: formatQueueDate(report.createdAt),
        riskLevel: 'medium' as const,
        action: reviewReportAction.bind(null, report.id, 'reviewed'),
      })),
    },
    {
      key: 'feedback',
      title: '使用者回饋',
      count: feedbackItems.length,
      href: '/admin/signals/feedback',
      emptyMessage: '目前沒有待處理的使用者回饋。',
      items: feedbackItems.map((feedback) => ({
        id: feedback.id,
        label: feedback.title ?? feedback.body ?? '未命名回饋',
        sublabel: feedback.userEmail ?? feedback.source,
        date: formatQueueDate(feedback.createdAt),
        action: reviewFeedbackAction.bind(null, feedback.id, 'reviewed'),
      })),
    },
  ].sort((left, right) => right.count - left.count)

  const overviewStats = [
    {
      label: '品牌總數',
      value: brandResult.totalCount,
      description: '資料庫中的品牌筆數',
    },
    {
      label: '啟用標籤',
      value: activeTagCount,
      description: '目前可供分類使用',
    },
    {
      label: '待審核內容警示',
      value: flaggedContent.length,
      description: '內容審查佇列中的旗標',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <p className="text-warm-caption">
          檢視需要處理的審核佇列、品牌資料與分類狀態。
        </p>
      </div>

      <SystemStatusCard initialResults={healthResults} />

      <section aria-labelledby="review-queues">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 id="review-queues" className="text-xl font-semibold">
              審核佇列
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              依目前待處理數量排序。
            </p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {queues.map((queue) => (
            <div key={queue.key} data-testid="queue-summary-card">
              <QueueSummaryCard
                title={queue.title}
                count={queue.count}
                href={queue.href}
                emptyMessage={queue.emptyMessage}
              >
                {queue.items.map((item) => (
                  <DashboardQueueItem
                    key={item.id}
                    label={item.label}
                    sublabel={item.sublabel}
                    date={item.date}
                    riskLevel={item.riskLevel}
                    onApprove={item.action}
                  />
                ))}
              </QueueSummaryCard>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="overview">
        <div className="mb-4">
          <h2 id="overview" className="text-xl font-semibold">
            總覽
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            站台資料與治理範圍的快速指標。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {overviewStats.map((stat) => (
            <Card key={stat.label}>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-heading text-4xl font-bold">{stat.value}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {stat.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="newsletter-subscribers">
        <div className="mb-4">
          <h2 id="newsletter-subscribers" className="text-xl font-semibold">
            Newsletter Subscribers
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Email capture list and subscription confirmation status.
          </p>
        </div>

        <NewsletterSubscribersList
          subscribers={subscribers}
          stats={subscriberStats}
        />
      </section>

    </div>
  )
}
