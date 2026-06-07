'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

interface AboutHeroProps {
  brandCount: number
  categoryCount: number
}

export default function AboutHero({ brandCount, categoryCount }: AboutHeroProps) {
  const t = useTranslations('about')

  return (
    <section className="relative overflow-hidden py-16 md:py-24">
      <Image
        src="/images/manifesto-bg.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative mx-auto max-w-3xl px-6 text-center md:px-10">
        <p className="text-sm font-semibold text-white/80">
          {t('hero.eyebrow')}
        </p>
        <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-white lg:text-6xl">
          {t('hero.title')}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-white/80">
          {t('hero.subtitle')}
        </p>
        <div className="mt-7 inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-white/20 bg-white/15 px-5 py-2.5 text-sm font-semibold text-white shadow-sm backdrop-blur-md">
          <span>{brandCount}</span>
          <span>{t('stats.brandUnit')}</span>
          <span>·</span>
          <span>{categoryCount}</span>
          <span>{t('stats.categoryUnit')}</span>
          <span className="text-white/80">{t('hero.statSuffix')}</span>
        </div>
        <div className="mt-8">
          <Link
            href="/brands"
            className="inline-flex items-center justify-center rounded-lg bg-cta px-8 py-3 text-base font-semibold text-cta-foreground transition-colors hover:bg-cta/90"
          >
            {t('hero.cta')}
          </Link>
        </div>
      </div>
    </section>
  )
}
