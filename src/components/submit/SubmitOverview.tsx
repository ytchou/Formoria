'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const HERO_IMAGE_SRC = '/images/submit-hero.png'

type SubmitOverviewProps = {
  nextPath?: string
  isLoggedIn?: boolean
}

export default function SubmitOverview({ nextPath = '/submit/form', isLoggedIn = false }: SubmitOverviewProps) {
  const t = useTranslations('submit.overview')
  const [imageFailed, setImageFailed] = useState(false)

  const content = (
    <div>
      <h1 className="font-heading text-3xl font-bold text-foreground">
        {t('heading')}
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        {t('description')}
      </p>
      <ul className="mt-8 space-y-3">
        <li className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cta text-xs font-bold text-cta-foreground">1</span>
          <span className="text-sm text-foreground">{t('step1')}</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cta text-xs font-bold text-cta-foreground">2</span>
          <span className="text-sm text-foreground">{t('step2')}</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cta text-xs font-bold text-cta-foreground">3</span>
          <span className="text-sm text-foreground">{t('step3')}</span>
        </li>
      </ul>
      <p className="mt-6 text-sm text-muted-foreground">{t('timeEstimate')}</p>
      <Link
        href={isLoggedIn ? nextPath : `/auth/sign-in?next=${nextPath}`}
        className={cn(buttonVariants({ variant: 'cta' }), 'mt-8')}
      >
        {isLoggedIn ? t('ctaLoggedIn') : t('cta')}
      </Link>
    </div>
  )

  // Single brand-neutral hero image; falls back to the single-column intro if the
  // asset is missing (404) so we never show a broken tile.
  if (imageFailed) {
    return <main className="mx-auto max-w-2xl px-6 py-20">{content}</main>
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
        {content}
        <div className="relative aspect-[4/5] overflow-hidden rounded-xl border border-border bg-muted">
          <Image
            src={HERO_IMAGE_SRC}
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 480px"
            onError={() => setImageFailed(true)}
          />
        </div>
      </div>
    </main>
  )
}
