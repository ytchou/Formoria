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
      className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
    >
      {t('removal.trigger')}
    </a>
  )
}
