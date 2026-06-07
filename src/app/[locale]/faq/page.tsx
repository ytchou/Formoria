import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ChevronDown } from 'lucide-react'
import { buildFaqPageJsonLd } from '@/lib/json-ld'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { CONTACT_EMAILS } from '@/lib/constants'

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('faq.metadata')
  const { canonical, languages } = buildAlternates('/faq', safeLocale)
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical, languages },
  }
}

export default async function FaqPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('faq')

  const plainItemKeys = [
    'whatIsFormoria',
    'whatDoesMitMean',
    'howToSubmit',
    'reviewTime',
    'claimOrUpdate',
    'dataAccuracy',
  ] as const

  const faqItems = [
    ...plainItemKeys.map((key) => ({
      question: t(`items.${key}.question`),
      answer: t(`items.${key}.answer`),
    })),
    {
      question: t('items.contact.question'),
      answer: t.rich('items.contact.answer', {
        email: CONTACT_EMAILS.contact,
        mail: (chunks) => String(chunks),
      }) as unknown as string,
    },
  ]

  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqPageJsonLd(faqItems, safeLocale)) }}
      />
      <section className="space-y-4">
        <h1 className="font-heading text-[26px] font-bold text-foreground">{t('title')}</h1>
        <p className="max-w-2xl font-sans text-sm leading-[1.7] text-muted-foreground">
          {t('intro')}
        </p>
      </section>
      <div className="mt-12 divide-y divide-border">
        {plainItemKeys.map((key, i) => (
          <details key={i} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between font-heading text-base font-semibold text-foreground [&::-webkit-details-marker]:hidden">
              {t(`items.${key}.question`)}
              <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <p className="mt-3 max-w-2xl font-sans text-sm leading-[1.7] text-muted-foreground">
              {t(`items.${key}.answer`)}
            </p>
          </details>
        ))}
        <details className="group py-5">
          <summary className="flex cursor-pointer list-none items-center justify-between font-heading text-base font-semibold text-foreground [&::-webkit-details-marker]:hidden">
            {t('items.contact.question')}
            <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <p className="mt-3 max-w-2xl font-sans text-sm leading-[1.7] text-muted-foreground">
            {t.rich('items.contact.answer', {
              email: CONTACT_EMAILS.contact,
              mail: (chunks) => (
                <a
                  href={`mailto:${CONTACT_EMAILS.contact}`}
                  className="underline underline-offset-4"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </details>
      </div>
    </main>
  )
}
