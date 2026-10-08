import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import type { Locale } from './alternates'

/**
 * Metadata for every branded 404 surface.
 *
 * A `not-found` boundary's metadata is applied after its layouts', so the
 * explicit `canonical: null` and empty `languages` here are what stop a 404
 * from inheriting the homepage canonical and hreflang that
 * `[locale]/(site)/layout.tsx` sets.
 *
 * The locale is passed to `getTranslations` explicitly: an implicit lookup
 * falls back to `headers()`, which breaks static renders (DEV-1493).
 */
export async function buildNotFoundMetadata(
  locale: string | undefined,
): Promise<Metadata> {
  const safeLocale: Locale = locale === 'en' ? 'en' : 'zh-TW'
  const t = await getTranslations({ locale: safeLocale, namespace: 'errors' })

  return {
    title: t('notFound.title'),
    robots: { index: false, follow: true },
    alternates: { canonical: null, languages: {} },
  }
}
