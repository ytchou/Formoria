'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

export function RequiredFieldsHint({ className }: { className?: string }) {
  const t = useTranslations('dashboard.edit')

  return (
    <p className={cn('type-metadata', className)}>
      <span aria-hidden="true" className="text-danger">
        *
      </span>{' '}
      {t('requiredHint')}
    </p>
  )
}
