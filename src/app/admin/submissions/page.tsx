import type { Metadata } from 'next'
import { getSubmissions } from '@/lib/services/submissions'
import { SubmissionsList } from '@/components/admin/submissions-list'

export const metadata: Metadata = {
  title: '待審核提交 | 管理後台 | MIT Map',
}

export default async function SubmissionsPage() {
  const submissions = await getSubmissions()

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Submissions
      </h1>
      <p className="mt-2 text-[#7C7570]">
        Review and manage brand submissions.
      </p>

      <div className="mt-8">
        <SubmissionsList submissions={submissions} />
      </div>
    </div>
  )
}
