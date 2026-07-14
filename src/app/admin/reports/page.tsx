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
        <h1 className="type-section-title-large">Brand Reports</h1>
        <p className="mt-1 type-body-muted">Review brand issues reported by the community</p>
      </div>
      <ReportsTable reports={reports} />
    </div>
  )
}
