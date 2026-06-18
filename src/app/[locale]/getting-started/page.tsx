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
import { buildFaqPageJsonLd } from '@/lib/json-ld'
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqPageJsonLd(faqItems, safeLocale)) }}
      />
      <section className="grid gap-8 border-b border-border pb-10 md:grid-cols-[minmax(0,1fr)_18rem] md:items-end">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold text-primary">{t('hero.eyebrow')}</p>
          <h1 className="mt-3 font-heading text-4xl font-bold text-foreground md:text-5xl">
            {t('hero.title')}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            {t('hero.intro')}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
          <Link
            href="/submit"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-cta px-5 py-3 text-sm font-medium text-white hover:bg-cta/90"
          >
            {t('hero.primaryCta')}
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/brands"
            className="inline-flex items-center justify-center rounded-lg border border-border px-5 py-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            {t('hero.secondaryCta')}
          </Link>
        </div>
      </section>

      <section className="py-10">
        <h2 className="font-heading text-2xl font-bold text-foreground">
          {t('steps.heading')}
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {steps.map((step, index) => (
            <article key={step} className="rounded-xl border border-border bg-card p-5">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {index + 1}
              </div>
              <h3 className="mt-4 text-base font-semibold text-foreground">
                {t(`steps.${step}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t(`steps.${step}.body`)}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-8 border-t border-border py-10 md:grid-cols-[18rem_minmax(0,1fr)]">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">
            {t('questions.heading')}
          </h2>
        </div>
        <Accordion type="single" collapsible defaultValue="eligibility">
          {questions.map((question) => (
            <AccordionItem key={question} value={question}>
              <AccordionTrigger className="font-heading text-base font-semibold text-foreground">
                {t(`questions.${question}.question`)}
              </AccordionTrigger>
              <AccordionContent className="max-w-2xl text-sm leading-6 text-muted-foreground">
                {t(`questions.${question}.answer`)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      <section className="grid gap-8 border-t border-border py-10 md:grid-cols-[18rem_minmax(0,1fr)]">
        <h2 className="font-heading text-2xl font-bold text-foreground">
          {t('tips.heading')}
        </h2>
        <ul className="grid gap-3">
          {tips.map((tip) => (
            <li key={tip} className="flex gap-3 text-sm leading-6 text-muted-foreground">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
              <span>{t(`tips.${tip}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-8 border-t border-border py-10 md:grid-cols-[18rem_minmax(0,1fr)]">
        <h2 className="font-heading text-2xl font-bold text-foreground">
          {t('forOwners.heading')}
        </h2>
        <OwnerBenefitsSection />
      </section>

      <section className="rounded-xl border border-border bg-card p-6 md:flex md:items-center md:justify-between md:gap-8">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground">
            {t('cta.heading')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t('cta.body')}
          </p>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row md:mt-0">
          <Link
            href="/submit"
            className="inline-flex items-center justify-center rounded-lg bg-cta px-5 py-3 text-sm font-medium text-white hover:bg-cta/90"
          >
            {t('cta.submit')}
          </Link>
          <Link
            href="/faq"
            className="inline-flex items-center justify-center rounded-lg border border-border px-5 py-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            {t('cta.faq')}
          </Link>
        </div>
      </section>
    </main>
  )
}
