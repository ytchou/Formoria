import { getPendingReports } from '@/lib/services/reports'
import { ReportsTable } from '@/components/admin/reports-table'

export const metadata = { title: 'Brand Reports | Admin | MIT Map' }

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
        <p className="mt-1 text-secondary">審核社群回報的品牌問題</p>
      </div>
      {reports.length === 0 ? (
        <p className="text-secondary">目前沒有待處理的檢舉。</p>
      ) : (
        <ReportsTable reports={reports} />
      )}
    </div>
  )
}
