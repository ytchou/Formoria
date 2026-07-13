import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { OwnerBenefitsSection } from '@/components/getting-started/OwnerBenefitsSection'
import { buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'

export const revalidate = 86400

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('gettingStarted.metadata')
  const title = t('title')
  const description = t('description')
  const { canonical, languages } = buildAlternates('/getting-started', safeLocale)
  const ogLocale = safeLocale === 'en' ? 'en_US' : 'zh_TW'
  const ogAlternateLocale = safeLocale === 'en' ? 'zh_TW' : 'en_US'

  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: {
      title,
      description,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function GettingStartedPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('gettingStarted')

  const steps = ['discover', 'submit', 'review', 'manage'] as const
  const tips = ['accurate', 'photos', 'links'] as const
  const stepCtas: Partial<Record<(typeof steps)[number], { href: string; label: string }>> = {
    discover: { href: '/brands', label: t('steps.discover.cta') },
    submit: { href: '/brands', label: t('steps.submit.cta') },
  }

  return (
    <main className="page-gutter mx-auto w-full max-w-screen-xl py-10">
      <section className="grid gap-8 border-b border-border pb-10 md:grid-cols-[minmax(0,1fr)_18rem] md:items-end">
        <div className="max-w-3xl">
          <p className="type-eyebrow">{t('hero.eyebrow')}</p>
          <h1 className="mt-3 type-hero">
            {t('hero.title')}
          </h1>
          <p className="mt-4 max-w-2xl type-page-subtitle">
            {t('hero.intro')}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
          <Link
            href="/brands"
            className={buttonVariants({ variant: 'primary', tone: 'cta' })}
          >
            {t('hero.primaryCta')}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            href="/faq"
            className={buttonVariants({ variant: 'secondary' })}
          >
            {t('hero.secondaryCta')}
          </Link>
        </div>
      </section>

      <section className="py-10">
        <h2 className="type-section-title-large">
          {t('steps.heading')}
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {steps.map((step, index) => {
            const cta = stepCtas[step]

            return (
              <article key={step} className={surfaceCardStyles()}>
                <div className="flex size-8 items-center justify-center rounded-full bg-primary type-subsection-title text-primary-foreground">
                  {index + 1}
                </div>
                <h3 className="mt-4 type-card-title">
                  {t(`steps.${step}.title`)}
                </h3>
                <p className="mt-2 type-card-description">
                  {t(`steps.${step}.body`)}
                </p>
                {cta ? (
                  <Link
                    href={cta.href}
                    className={buttonVariants({
                      variant: 'secondary',
                      size: 'large',
                      className: 'mt-5 w-fit',
                    })}
                  >
                    {cta.label}
                  </Link>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      <section className="grid gap-8 border-t border-border py-10 md:grid-cols-[18rem_minmax(0,1fr)]">
        <h2 className="type-section-title-large">
          {t('tips.heading')}
        </h2>
        <ul className="grid gap-3">
          {tips.map((tip) => (
            <li key={tip} className="flex gap-3 type-card-description">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <span>{t(`tips.${tip}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-8 border-t border-border py-10 md:grid-cols-[18rem_minmax(0,1fr)]">
        <h2 className="type-section-title-large">
          {t('forOwners.heading')}
        </h2>
        <OwnerBenefitsSection />
      </section>

      <section
        className={surfaceCardStyles({
          className: 'md:flex md:items-center md:justify-between md:gap-8',
          padding: 'lg',
        })}
      >
        <div>
          <h2 className="type-section-title-large">
            {t('cta.heading')}
          </h2>
          <p className="mt-2 type-card-description">
            {t('cta.body')}
          </p>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row md:mt-0">
          <Link
            href="/brands"
            className={buttonVariants({ variant: 'primary', tone: 'cta' })}
          >
            {t('cta.browse')}
          </Link>
          <Link
            href="/faq"
            className={buttonVariants({ variant: 'secondary' })}
          >
            {t('cta.faq')}
          </Link>
        </div>
      </section>
    </main>
  )
}
