import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

interface AboutHeroProps {
  brandCount: number
  categoryCount: number
}

export default function AboutHero({ brandCount, categoryCount }: AboutHeroProps) {
  const t = useTranslations('about')

  return (
    <section className="grid items-stretch lg:grid-cols-2">
      <div className="relative min-h-[18rem] lg:min-h-[34rem]">
        <Image
          src="/images/manifesto-bg.png"
          alt=""
          fill
          priority
          sizes="(max-width:1024px) 100vw, 50vw"
          className="object-cover"
        />
      </div>
      <div className="flex flex-col justify-center px-6 py-12 md:px-10 lg:py-20">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('hero.eyebrow')}
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-foreground md:text-5xl lg:text-6xl">
            {t('hero.title')}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            {t('hero.subtitle')}
          </p>
          <p className="mt-6 text-sm text-muted-foreground">
            {brandCount} {t('stats.brandUnit')} · {categoryCount} {t('stats.categoryUnit')}
            {t('hero.statSuffix')}
          </p>
          <Link
            href="/brands"
            className="mt-8 inline-flex items-center justify-center rounded-lg bg-cta px-7 py-3 text-base font-semibold text-cta-foreground transition-colors hover:bg-cta/90"
          >
            {t('hero.cta')}
          </Link>
        </div>
      </div>
    </section>
  )
}
