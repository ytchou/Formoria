import type { Metadata } from 'next'
import { ReportsTable } from '@/components/admin/reports-table'
import { getPendingReports } from '@/lib/services/reports'

export const metadata: Metadata = { title: 'Brand Reports | Admin' }

export default async function AdminReportsPage() {
  let reports: Awaited<ReturnType<typeof getPendingReports>> = []
  try {
    reports = await getPendingReports()
  } catch (err) {
    console.error('[admin:reports]', err)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold">品牌檢舉</h1>
        <p className="mt-1 text-muted-foreground">審核社群回報的品牌問題</p>
      </div>
      <ReportsTable reports={reports} />
    </div>
  )
}
