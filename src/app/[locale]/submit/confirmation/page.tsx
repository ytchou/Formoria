import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Check, Home, Plus } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'

type ConfirmationPageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: ConfirmationPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('submit.confirmation.metadata')
  const title = t('title')
  const description = t('description')
  const ogLocale = safeLocale === 'en' ? 'en_US' : 'zh_TW'
  const ogAlternateLocale = safeLocale === 'en' ? 'zh_TW' : 'en_US'

  return {
    title,
    description,
    alternates: buildAlternates('/submit/confirmation', safeLocale),
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

export default async function ConfirmationPage({ params }: ConfirmationPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('submit.confirmation')

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-[560px] rounded-2xl border border-[#E8E5E0] bg-white p-10 shadow-sm">
        {/* Success badge */}
        <div className="flex justify-center">
          <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-cta">
            <Check className="h-8 w-8 text-white" strokeWidth={3} />
          </div>
        </div>

        <h1 className="mt-6 text-center font-heading text-[22px] font-bold text-foreground">
          {t('subheading')}
        </h1>

        {/* Timeline */}
        <div className="mt-8 rounded-xl bg-[#FAFAF8] p-6">
          <div className="space-y-4">
            {([
              { label: t('timeline.review.label'), description: t('timeline.review.description'), active: true },
              { label: t('timeline.contact.label'), description: t('timeline.contact.description'), active: false },
              { label: t('timeline.live.label'), description: t('timeline.live.description'), active: false },
            ] as const).map((step, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`h-3 w-3 shrink-0 rounded-full ${
                      step.active ? 'bg-cta' : 'bg-[#D4CFC9]'
                    }`}
                  />
                  {i < 2 && (
                    <div className="mt-1 h-full w-px bg-[#D4CFC9]" />
                  )}
                </div>
                <div className="pb-4">
                  <p
                    className={`text-sm font-semibold ${
                      step.active ? 'text-[#1A1918]' : 'text-[#7C7570]'
                    }`}
                  >
                    {step.label}
                  </p>
                  <p className="mt-0.5 text-xs text-[#B0AAA4]">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          {t.rich('whatNext.learnMore.answer', {
            link: (chunks) => (
              <Link href="/getting-started" className="text-foreground underline">
                {chunks}
              </Link>
            ),
          })}
        </p>

        {/* CTAs */}
        <div className="mt-8 space-y-3">
          <Link
            href="/"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-cta px-5 py-3 text-sm font-medium text-white hover:bg-cta/90"
          >
            <Home className="h-4 w-4" />
            {t('cta.explore')}
          </Link>
          <Link
            href="/submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#D4CFC9] bg-white px-5 py-3 text-sm font-medium text-[#1A1918] hover:bg-[#F5F4F1]"
          >
            <Plus className="h-4 w-4" />
            {t('cta.submitAnother')}
          </Link>
        </div>
      </div>
    </div>
  )
}
