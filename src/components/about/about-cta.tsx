import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

export default function AboutCta() {
  const t = useTranslations('about')

  return (
    <section className="relative overflow-hidden py-16 md:py-24">
      <Image
        src="/images/hero-bg.png"
        alt=""
        fill
        className="object-cover"
      />
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative mx-auto max-w-3xl px-6 text-center md:px-10">
        <h2 className="font-heading text-3xl font-bold leading-tight text-white md:text-4xl lg:text-5xl">
          {t('cta.heading')}
        </h2>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/brands"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-cta px-8 py-3 text-base font-semibold text-cta-foreground transition-colors hover:bg-cta/90"
          >
            {t('cta.primary')}
          </Link>
          <Link
            href="/submit"
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-white hover:text-foreground"
          >
            {t('cta.secondary')}
          </Link>
        </div>
      </div>
    </section>
  )
}
