'use client'

import { useTranslations } from 'next-intl'
import { CONTACT_EMAILS } from '@/lib/constants'

type RequestRemovalProps = {
  brandName: string
  brandSlug: string
}

export function RequestRemoval({ brandName, brandSlug }: RequestRemovalProps) {
  const t = useTranslations('brandDetail')
  const subject = t('removal.mailtoSubject', { name: brandName, slug: brandSlug })
  const body = t('removal.mailtoBody', { name: brandName, slug: brandSlug })
  const mailto = `mailto:${CONTACT_EMAILS.operations}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  return (
    <a
      href={mailto}
      className="inline-flex min-h-12 items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
    >
      {t('removal.trigger')}
    </a>
  )
}
