import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ChevronDown } from 'lucide-react'
import { buildFaqPageJsonLd } from '@/lib/json-ld'

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('faq.metadata')
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: '/faq' },
  }
}

export default async function FaqPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('faq')

  const faqItemKeys = [
    'whatIsMitMap',
    'whatDoesMitMean',
    'howToSubmit',
    'reviewTime',
    'claimOrUpdate',
    'dataAccuracy',
    'contact',
  ] as const

  const faqItems = faqItemKeys.map((key) => ({
    question: t(`items.${key}.question`),
    answer: t(`items.${key}.answer`),
  }))

  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqPageJsonLd(faqItems)) }}
      />
      <section className="space-y-4">
        <h1 className="font-heading text-[26px] font-bold text-foreground">{t('title')}</h1>
        <p className="max-w-2xl font-sans text-sm leading-[1.7] text-muted-foreground">
          {t('intro')}
        </p>
      </section>
      <div className="mt-12 divide-y divide-border">
        {faqItems.map((item, i) => (
          <details key={i} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between font-heading text-base font-semibold text-foreground [&::-webkit-details-marker]:hidden">
              {item.question}
              <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <p className="mt-3 max-w-2xl font-sans text-sm leading-[1.7] text-muted-foreground">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </main>
  )
}
