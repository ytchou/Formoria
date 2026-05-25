import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserSubmissions } from '@/lib/services/submissions'
import { Badge } from '@/components/ui/badge'

export const metadata: Metadata = {
  title: '我的提交 | MIT Map',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '審核中',
  approved: '已通過',
  rejected: '已拒絕',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-[#F5F4F1] text-[#7C7570] border-[#D4CFC9]',
  approved: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
}

export default async function MySubmissionsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/sign-in?next=/my-submissions')
  }

  const submissions = await getUserSubmissions(user.email ?? '')

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-heading text-3xl font-bold tracking-tight text-[#1A1918]">
        我的提交
      </h1>
      <p className="mt-2 text-sm text-[#7C7570]">
        查看您提交的所有品牌
      </p>

      {submissions.length === 0 ? (
        <div className="mt-8 rounded-xl border border-[#E8E5E0] bg-white p-8 text-center">
          <p className="text-sm text-[#7C7570]">
            您尚未提交任何品牌。
          </p>
          <Link
            href="/submit"
            className="mt-4 inline-flex rounded-full bg-[#E06B3F] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#C85A33]"
          >
            提交品牌
          </Link>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {submissions.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center justify-between rounded-xl border border-[#E8E5E0] bg-white px-5 py-4"
            >
              <div>
                <p className="font-medium text-[#1A1918]">{sub.brandName}</p>
                <p className="mt-0.5 text-xs text-[#B0AAA4]">
                  {new Date(sub.createdAt).toLocaleDateString('zh-TW')}
                </p>
              </div>
              <Badge
                variant="outline"
                className={STATUS_COLORS[sub.status] ?? STATUS_COLORS.pending}
              >
                {STATUS_LABELS[sub.status] ?? sub.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
