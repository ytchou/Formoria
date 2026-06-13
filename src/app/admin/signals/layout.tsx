import type { ReactNode } from 'react'

import { AdminSubNav } from '@/components/admin/admin-sub-nav'
import { getFeedbackItems } from '@/lib/services/feedback'
import { getPendingReports } from '@/lib/services/reports'

type SignalsLayoutProps = {
  children: ReactNode
}

export default async function SignalsLayout({ children }: SignalsLayoutProps) {
  const [reports, feedbackItems] = await Promise.all([
    getPendingReports(),
    getFeedbackItems({ status: 'open' }),
  ])

  const tabs = [
    {
      label: '檢舉',
      href: '/admin/signals/reports',
      count: reports.length,
    },
    {
      label: 'Feedback',
      href: '/admin/signals/feedback',
      count: feedbackItems.length,
    },
  ]

  return (
    <>
      <AdminSubNav tabs={tabs} />
      {children}
    </>
  )
}
