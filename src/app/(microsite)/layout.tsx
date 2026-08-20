import type { Metadata } from 'next'
import { RootDocument } from '@/components/shared/root-document'
import zhTW from '../../../messages/zh-TW.json'
import { getSiteUrl } from '@/lib/seo/site-url'
import '../globals.css'

/**
 * NOINDEX IS LOAD-BEARING, AND IT REGRESSES SILENTLY.
 *
 * A brand microsite duplicates the brand's own detail page at
 * `/brands/[slug]`, so indexing it would put Formoria in competition with
 * itself for every brand query. Nothing about that failure is visible: the
 * page is absent from search BECAUSE of this line, so every search-based check
 * looks identical whether the line is here or not.
 *
 * It is therefore asserted in three places — here via
 * `src/components/microsite/__tests__/v2-tokens.test.ts`, on the page metadata
 * via `microsite-helpers.test.ts`, and against the rendered `<meta>` in
 * `e2e/tests/static-pages.spec.ts`. `micrositeMetadata()` repeats the
 * directive on purpose: a page's own `robots` replaces the layout's rather
 * than merging with it.
 */
export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  robots: { index: false, follow: true },
}

export default function MicrositeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <RootDocument
      locale="zh-TW"
      skipToContentLabel={zhTW.common.skipToContent}
    >
      {children}
    </RootDocument>
  )
}
