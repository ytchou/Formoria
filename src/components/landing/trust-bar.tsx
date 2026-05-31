'use client'

import { useTranslations } from 'next-intl'

interface TrustBarProps {
  brandCount: number
  categoryCount: number
}

export default function TrustBar({ brandCount, categoryCount }: TrustBarProps) {
  const t = useTranslations('landing.trustBar')

  return (
    <section className="py-2 text-center font-heading">
      <div className="flex items-center justify-center gap-4">
        <span className="rounded-full bg-primary px-6 py-2 text-base text-primary-foreground">
          {t('brandCount', { count: brandCount })}
        </span>
        <span className="rounded-full bg-primary px-6 py-2 text-base text-primary-foreground">
          {t('categoryCount', { count: categoryCount })}
        </span>
        <span className="rounded-full bg-primary px-6 py-2 text-base text-primary-foreground">
          {t('communityBuilt')}
        </span>
      </div>
    </section>
  )
}
