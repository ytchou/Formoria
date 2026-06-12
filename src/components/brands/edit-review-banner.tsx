'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { PendingBrandEdit } from '@/lib/types/brand'

type Props = {
  edit: PendingBrandEdit | null
  brandSlug: string
}

export function EditReviewBanner({ edit, brandSlug }: Props) {
  const [dismissed, setDismissed] = useState(false)

  if (edit === null) return null
  if (dismissed && edit.status === 'approved') return null

  if (edit.status === 'pending') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-3">
          <span className="text-amber-600">⏳</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">您的編輯正在審核中</p>
            <p className="text-xs text-amber-600">
              {new Date(edit.createdAt).toLocaleDateString('zh-TW')}
            </p>
          </div>
          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            審核中
          </span>
        </div>
      </div>
    )
  }

  if (edit.status === 'rejected') {
    return (
      <div className="rounded-xl border border-destructive bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-destructive">✕</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-destructive">編輯需要修改</p>
            {edit.reviewerNotes && (
              <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-destructive">
                {edit.reviewerNotes}
              </div>
            )}
            <Link
              href={`/dashboard/brands/${brandSlug}/edit`}
              className="mt-3 inline-block rounded-lg bg-[var(--cta)] px-4 py-2 text-sm font-semibold text-white"
            >
              重新編輯
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (edit.status === 'approved') {
    return (
      <div className="rounded-xl border border-[var(--verified-green)] bg-[var(--verified-green-bg)] p-4">
        <div className="flex items-center gap-3">
          <span className="text-[var(--verified-green)]">✓</span>
          <div>
            <p className="text-sm font-semibold text-[var(--verified-green)]">編輯已通過並上線</p>
            {edit.reviewedAt && (
              <p className="text-xs">
                {new Date(edit.reviewedAt).toLocaleDateString('zh-TW')}
              </p>
            )}
          </div>
          <button
            aria-label="關閉"
            onClick={() => setDismissed(true)}
            className="ml-auto text-sm text-muted-foreground"
          >
            ✕
          </button>
        </div>
      </div>
    )
  }

  return null
}
