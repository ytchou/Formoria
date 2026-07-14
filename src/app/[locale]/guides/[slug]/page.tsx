import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { ChevronRight } from 'lucide-react'
import { getGuideBySlug } from '@/lib/services/guides'
import { FaqBlock } from '@/components/guides/faq-block'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buildArticleJsonLd, safeJsonLdStringify } from '@/lib/json-ld'
import { GuideClient } from './guide-client'

type PageProps = {
  params: Promise<{ locale: string; slug: string }>
}

// The shared locale layout reads auth cookies, so guide pages must render per request.
export const revalidate = 0

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params
  const slug = decodeURIComponent(rawSlug)
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations({ locale, namespace: 'guideDetail' })
  const guide = await getGuideBySlug(slug)

  if (!guide) {
    return { title: t('metadata.notFoundTitle') }
  }

  const { canonical, languages } = buildAlternates(`/guides/${guide.entry.frontmatter.slug}`, safeLocale)

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
  const guide = await getGuideBySlug(slug)

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
      <nav aria-label="Breadcrumb" className="mb-6">
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
          <h1 className="type-page-title-large">
            {guide.entry.frontmatter.title}
          </h1>
          <p className="type-page-subtitle">
            {guide.entry.frontmatter.description}
          </p>
        </header>
        <div className="prose prose-neutral max-w-none prose-headings:scroll-mt-24 prose-a:break-words dark:prose-invert">
          <GuideClient
            data={guide.tina.data ?? {}}
            query={guide.tina.query}
            variables={guide.tina.variables}
          />
        </div>
        {guide.entry.frontmatter.faq && guide.entry.frontmatter.faq.length > 0 && (
          <FaqBlock questions={guide.entry.frontmatter.faq} />
        )}
      </article>
    </main>
  )
}
