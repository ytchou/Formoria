'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PendingBrandEdit } from '@/lib/types/brand'

type Props = {
  edit: PendingBrandEdit | null
  brandSlug: string
}

export function EditReviewBanner({ edit, brandSlug }: Props) {
  const t = useTranslations('admin.pendingEdits')
  const [dismissed, setDismissed] = useState(false)

  if (edit === null) return null
  if (dismissed && edit.status === 'approved') return null

  if (edit.status === 'pending') {
    return (
      <div className="rounded-xl border border-mit-verified/20 bg-mit-verified-bg p-4">
        <div className="flex items-center gap-3">
          <span className="text-mit-verified">⏳</span>
          <div>
            <p className="type-body-emphasis text-mit-verified">{t('pendingMessage')}</p>
            <p className="type-caption text-mit-verified">
              {new Date(edit.createdAt).toLocaleDateString('zh-TW')}
            </p>
          </div>
          <span className="ml-auto rounded-full bg-background px-2 py-0.5 type-caption text-mit-verified">
            {t('pending')}
          </span>
        </div>
      </div>
    )
  }

  if (edit.status === 'rejected') {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4">
        <div className="flex items-start gap-3">
          <span className="text-destructive">✕</span>
          <div className="flex-1">
            <p className="type-error">{t('rejected')}</p>
            {edit.reviewerNotes && (
              <div className="mt-2 rounded-lg border border-destructive/20 bg-background p-3 type-error">
                {edit.reviewerNotes}
              </div>
            )}
            <Link
              href={`/dashboard/brands/${brandSlug}/edit`}
              className="mt-3 inline-block rounded-lg bg-cta px-4 py-2 type-body-emphasis text-white"
            >
              {t('resubmit')}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (edit.status === 'approved') {
    return (
      <div className="rounded-xl border border-verified-green/20 bg-verified-green-bg p-4">
        <div className="flex items-center gap-3">
          <span className="text-verified-green">✓</span>
          <div>
            <p className="type-success">{t('approved')}</p>
            {edit.reviewedAt && (
              <p className="type-caption">
                {new Date(edit.reviewedAt).toLocaleDateString('zh-TW')}
              </p>
            )}
          </div>
          <Button
            type="button"
            aria-label={t('close')}
            onClick={() => setDismissed(true)}
            variant="ghost"
            size="icon"
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    )
  }

  return null
}
