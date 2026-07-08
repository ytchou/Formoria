'use client'

import { useTranslations } from 'next-intl'

export function RequiredFieldsHint() {
  const t = useTranslations('dashboard.edit')

  return (
    <p className="px-4 text-xs text-muted-foreground">
      <span aria-hidden="true" className="text-destructive">*</span>{' '}
      {t('requiredHint')}
    </p>
  )
}
