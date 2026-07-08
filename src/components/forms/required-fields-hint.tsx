'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

export function RequiredFieldsHint({ className }: { className?: string }) {
  const t = useTranslations('dashboard.edit')

  return (
    <p className={cn('type-caption', className)}>
      <span aria-hidden="true" className="text-destructive">
        *
      </span>{' '}
      {t('requiredHint')}
    </p>
  )
}
