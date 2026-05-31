import Image from 'next/image'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export default async function Manifesto() {
  const t = await getTranslations('landing.manifesto')

  return (
    <section className="relative py-16 md:py-24">
      <Image
        src="/images/manifesto-bg.png"
        alt=""
        fill
        className="object-cover"
      />
      <div className="absolute inset-0 bg-black/55" />
      <div className="relative mx-auto max-w-3xl px-6 text-center md:px-10">
        <h2 className="font-heading text-3xl font-bold leading-tight text-white lg:text-5xl">
          {t('headline')}
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-white/80">
          {t('body1')}
        </p>
        <p className="mt-3 text-lg leading-relaxed text-white/80">
          {t('body2')}
        </p>
        <Link
          href="/about"
          className="mt-8 inline-flex items-center justify-center rounded-lg bg-cta px-8 py-3 text-base font-semibold text-cta-foreground transition-colors hover:bg-cta/90"
        >
          {t('cta')}
        </Link>
      </div>
    </section>
  )
}
