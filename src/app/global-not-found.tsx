import type { Metadata } from 'next'
import { NotFoundPage } from '@/components/not-found-page'
import { buildNotFoundMetadata } from '@/lib/seo/not-found-metadata'
// LocaleLayout imports `./globals.css` itself, so the styles come with it.
import LocaleLayout from './[locale]/layout'
import SiteLayout from './[locale]/(site)/layout'

/**
 * The branded 404 for URLs that match no route at all — e.g. `/foo/bar`, where
 * `foo` is not a locale and `[locale]/layout.tsx` calls notFound(). The app has
 * several root layouts, so a root `not-found.tsx` cannot serve this; Next
 * renders this file instead, outside every layout, so it composes the zh-TW
 * locale and site shells itself.
 *
 * Ceiling: `experimental.globalNotFound` is experimental in Next 16.3. If an
 * upgrade removes or renames the flag, this file silently stops being used and
 * outside-locale URLs fall back to Next's unstyled default 404 — re-check the
 * not-found file-convention docs on every Next upgrade.
 */

const DEFAULT_LOCALE = 'zh-TW'

export async function generateMetadata(): Promise<Metadata> {
  const metadata = await buildNotFoundMetadata(DEFAULT_LOCALE)
  // No parent layout supplies the `%s | Formoria` template here, so apply it
  // by hand to match every other page title.
  return { ...metadata, title: `${String(metadata.title)} | Formoria` }
}

export default function GlobalNotFound() {
  return LocaleLayout({
    params: Promise.resolve({ locale: DEFAULT_LOCALE }),
    children: (
      <SiteLayout>
        <NotFoundPage />
      </SiteLayout>
    ),
  })
}
