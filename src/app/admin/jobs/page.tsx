import type { Metadata } from 'next'
import { listCurationJobsAction } from '@/app/admin/operations/actions'
import { JobHistoryList } from './job-history-list'

export const metadata: Metadata = { title: '工作紀錄 | 管理後台' }
export const revalidate = 0

export default async function JobsPage() {
  const result = await listCurationJobsAction()

  if ('error' in result) {
    return (
      <div className="space-y-4">
        <h1 className="type-section-title-large">工作紀錄</h1>
        <p className="type-error">{result.error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="type-section-title-large">工作紀錄</h1>
        <p className="mt-1 type-card-description">查看所有工作的執行狀態與結果。</p>
      </div>
      <JobHistoryList initialJobs={result.jobs} railwayLogsUrl={process.env.RAILWAY_LOGS_URL} />
    </div>
  )
}
