'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

function HeroSection() {
  const t = useTranslations('landing.hero')

  return (
    <section className="relative py-16 md:py-24">
      <Image
        src="/images/hero-bg.png"
        alt=""
        fill
        priority
        className="object-cover"
      />
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative mx-auto max-w-3xl px-6 text-center md:px-10">
        <h1 className="font-heading text-4xl font-bold leading-tight text-white lg:text-6xl">
          {t('headline')}
        </h1>
        <p className="mt-4 text-lg text-white/80">
          {t('subheadline')}
        </p>
        <Link
          href="/brands"
          className="mt-8 inline-flex items-center justify-center rounded-lg bg-cta px-8 py-3 text-base font-semibold text-cta-foreground transition-colors hover:bg-cta/90"
        >
          {t('cta')}
        </Link>
      </div>
    </section>
  )
}

export default HeroSection
