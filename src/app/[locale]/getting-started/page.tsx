import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { OwnerBenefitsSection } from '@/components/getting-started/OwnerBenefitsSection'
import { buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import { buildFaqPageJsonLd, safeJsonLdStringify } from '@/lib/json-ld'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'

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
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('gettingStarted')

  const steps = ['discover', 'submit', 'review', 'manage'] as const
  const questions = ['eligibility', 'details', 'review', 'approval', 'claim'] as const
  const tips = ['accurate', 'photos', 'links'] as const
  const faqItems = questions.map((question) => ({
    question: t(`questions.${question}.question`),
    answer: t(`questions.${question}.answer`),
  }))

  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(buildFaqPageJsonLd(faqItems, safeLocale)) }}
      />
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
            href="/submit"
            className={buttonVariants({ variant: 'primary', tone: 'cta' })}
          >
            {t('hero.primaryCta')}
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/brands"
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
          {steps.map((step, index) => (
            <article key={step} className={surfaceCardStyles()}>
              <div className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {index + 1}
              </div>
              <h3 className="mt-4 type-card-title">
                {t(`steps.${step}.title`)}
              </h3>
              <p className="mt-2 type-card-description">
                {t(`steps.${step}.body`)}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-8 border-t border-border py-10 md:grid-cols-[18rem_minmax(0,1fr)]">
        <div>
          <h2 className="type-section-title-large">
            {t('questions.heading')}
          </h2>
        </div>
        <Accordion type="single" collapsible defaultValue="eligibility">
          {questions.map((question) => (
            <AccordionItem key={question} value={question}>
              <AccordionTrigger className="type-card-title">
                {t(`questions.${question}.question`)}
              </AccordionTrigger>
              <AccordionContent className="max-w-2xl type-card-description">
                {t(`questions.${question}.answer`)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      <section className="grid gap-8 border-t border-border py-10 md:grid-cols-[18rem_minmax(0,1fr)]">
        <h2 className="type-section-title-large">
          {t('tips.heading')}
        </h2>
        <ul className="grid gap-3">
          {tips.map((tip) => (
            <li key={tip} className="flex gap-3 type-card-description">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
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
            href="/submit"
            className={buttonVariants({ variant: 'primary', tone: 'cta' })}
          >
            {t('cta.submit')}
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
