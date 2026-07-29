import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { FeatureRequestFilters } from '@/components/feedback/feature-request-filters'
import { FeatureRequestList } from '@/components/feedback/feature-request-list'
import { SubmitRequestDialog } from '@/components/feedback/submit-request-dialog'
import { Typography } from '@/components/ui/typography'
import { FeatureRequestVotesProvider } from '@/hooks/use-feature-request-votes'
import { buildAlternates, type Locale } from '@/lib/seo/alternates'
import {
  isFeatureRequestCategory,
  listFeatureRequests,
  type FeatureRequestCategory,
} from '@/lib/services/feature-requests'

type PageProps = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readCategory(
  searchParams: Record<string, string | string[] | undefined>,
): FeatureRequestCategory | null {
  const raw = searchParams.category
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && isFeatureRequestCategory(value) ? value : null
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('feedback.metadata')
  const title = t('title')
  const description = t('description')
  const { canonical, languages } = buildAlternates('/feedback', safeLocale)
  const ogLocale = safeLocale === 'en' ? 'en_US' : 'zh_TW'
  const ogAlternateLocale = safeLocale === 'en' ? 'zh_TW' : 'en_US'

  return {
    title,
    description,
    // The board is a community scratchpad, not a search destination: indexing
    // it would put unvetted user copy on the site's SEO surface. `follow` stays
    // on so the links out of it still pass authority.
    robots: { index: false, follow: true },
    // routing.ts sets `alternateLinks: false`, so without this the page would
    // ship with no hreflang at all.
    alternates: { canonical, languages },
    openGraph: {
      title,
      description,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function FeedbackPage({
  params,
  searchParams,
}: PageProps) {
  const [{ locale }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ])
  setRequestLocale(locale)
  const category = readCategory(resolvedSearchParams)
  const [t, requests] = await Promise.all([
    getTranslations('feedback'),
    listFeatureRequests(category ? { category } : {}),
  ])

  return (
    // max-w-3xl, not the directory's max-w-6xl: the board is a single column of
    // one-line titles, and a wider measure would strand the upvote control.
    <div className="page-gutter mx-auto max-w-3xl py-12 md:py-16">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Typography as="h1" variant="pageTitle">
            {t('title')}
          </Typography>
          <Typography variant="pageSubtitle">{t('description')}</Typography>
        </div>
        <SubmitRequestDialog />
      </div>

      <div className="mt-8">
        <FeatureRequestFilters active={category} />
      </div>

      <div className="mt-6">
        <FeatureRequestVotesProvider>
          <FeatureRequestList requests={requests} />
        </FeatureRequestVotesProvider>
      </div>
    </div>
  )
}
