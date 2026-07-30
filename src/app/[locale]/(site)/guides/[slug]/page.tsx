import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { ChevronRight } from 'lucide-react'
import { getAllGuides, getPublishedGuideBySlug } from '@/lib/services/guides'
import { FaqBlock } from '@/components/guides/faq-block'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buildArticleJsonLd, safeJsonLdStringify } from '@/lib/json-ld'
import { GuideContent } from './guide-client'

type PageProps = {
  params: Promise<{ locale: string; slug: string }>
}

export const revalidate = 3600

// Prebuild every published guide so the first production visit is served from the
// ISR cache instead of paying on-demand generation. Locale comes from the parent
// `[locale]` layout's own `generateStaticParams`, so both locales are covered.
// `getAllGuides()` is the same published set the index and sitemap use; anything
// outside it (drafts, future non-zh-TW guides) still renders on demand.
// Deliberately no `dynamic = 'force-static'`: it strips request-scoped state, so
// next-intl's `getRequestLocale()` returns undefined and `src/i18n/request.ts`
// silently falls back to zh-TW on on-demand/ISR renders while `params.locale`
// still says `en`. `revalidate` + `generateStaticParams` gives SSG+ISR without it.
export async function generateStaticParams() {
  const result = await getAllGuides()
  if (!result.ok) return []
  // `guide.slug` is the filename stem, which is what the route param resolves against
  // (`getPublishedGuideBySlug` reads `content/guides/<param>.mdx`); `frontmatter.slug`
  // is only used for canonical URLs and may diverge.
  return result.guides.map((guide) => ({ slug: guide.slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params
  const slug = decodeURIComponent(rawSlug)
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const guide = await getPublishedGuideBySlug(slug, safeLocale)

  if (!guide) {
    notFound()
  }

  const { canonical, languages } = buildAlternates(
    `/guides/${guide.entry.frontmatter.slug}`,
    safeLocale,
    [safeLocale],
  )

  return {
    title: guide.entry.frontmatter.title,
    description: guide.entry.frontmatter.description,
    alternates: { canonical, languages },
  }
}

export default async function GuidePage({ params }: PageProps) {
  const { locale, slug: rawSlug } = await params
  const slug = decodeURIComponent(rawSlug)
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const guide = await getPublishedGuideBySlug(slug, safeLocale)

  if (!guide) {
    notFound()
  }

  const t = await getTranslations({ locale, namespace: 'guides' })

  const articleJsonLd = buildArticleJsonLd({
    title: guide.entry.frontmatter.title,
    description: guide.entry.frontmatter.description ?? '',
    path: `/guides/${guide.entry.frontmatter.slug}`,
    locale: safeLocale,
  })

  return (
    <main className="page-gutter mx-auto w-full max-w-[720px] py-12 md:py-16">
      <nav aria-label={t('breadcrumbAria')} className="mb-6">
        <ol className="flex items-center gap-1.5 type-card-description">
          <li>
            <Link href="/guides" className="hover:text-foreground transition-colors">
              {t('breadcrumb')}
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </li>
          <li>
            <span aria-current="page" className="text-foreground">
              {guide.entry.frontmatter.title}
            </span>
          </li>
        </ol>
      </nav>
      <article className="space-y-8">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify({
              ...articleJsonLd,
              datePublished: guide.entry.frontmatter.publishedAt,
              ...(guide.entry.frontmatter.updatedAt
                ? { dateModified: guide.entry.frontmatter.updatedAt }
                : {}),
            }),
          }}
        />
        <header className="space-y-4">
          <h1 className="type-page-title-large">{guide.entry.frontmatter.title}</h1>
          <p className="type-page-subtitle">{guide.entry.frontmatter.description}</p>
        </header>
        <div className="prose prose-neutral max-w-none prose-headings:scroll-mt-24 prose-a:break-words dark:prose-invert">
          <GuideContent source={guide.content} />
        </div>
        {guide.entry.frontmatter.faq && guide.entry.frontmatter.faq.length > 0 && (
          <FaqBlock questions={guide.entry.frontmatter.faq} />
        )}
      </article>
    </main>
  )
}
