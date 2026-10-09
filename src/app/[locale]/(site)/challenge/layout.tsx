import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale?: string }>
}): Promise<Metadata> {
  const { locale } = await params
  // Explicit locale: an implicit lookup falls back to `headers()` (DEV-1493).
  const t = await getTranslations({
    locale: locale === 'en' ? 'en' : 'zh-TW',
    namespace: 'challenge',
  })

  return {
    title: t('title'),
    robots: {
      index: false,
      follow: false,
    },
    // Replaces the homepage canonical and hreflang `(site)/layout.tsx` sets.
    alternates: { canonical: null, languages: {} },
  }
}

export default function ChallengeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
