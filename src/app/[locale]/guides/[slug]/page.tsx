import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { compileMDX } from 'next-mdx-remote/rsc'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import remarkGfm from 'remark-gfm'
import { getAllGuides, getGuideBySlug } from '@/lib/services/guides'
import { mdxComponents } from '@/lib/mdx/components'
import { FaqBlock } from '@/components/guides/faq-block'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buildArticleJsonLd, safeJsonLdStringify } from '@/lib/json-ld'

type PageProps = {
  params: Promise<{ locale: string; slug: string }>
}

export const revalidate = 3600

export async function generateStaticParams() {
  try {
    const guides = await getAllGuides()
    return guides.map((guide) => ({
      locale: 'zh-TW',
      slug: guide.frontmatter.slug,
    }))
  } catch {
    return []
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params
  const slug = decodeURIComponent(rawSlug)
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('guideDetail')
  const guide = await getGuideBySlug(slug)

  if (!guide) {
    return { title: t('metadata.notFoundTitle') }
  }

  const { canonical, languages } = buildAlternates(`/guides/${guide.frontmatter.slug}`, safeLocale)

  return {
    title: guide.frontmatter.title,
    description: guide.frontmatter.description,
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

  const { content } = await compileMDX({
    source: guide.content,
    components: mdxComponents,
    options: {
      parseFrontmatter: false,
      mdxOptions: {
        remarkPlugins: [remarkGfm],
      },
    },
  })

  const articleJsonLd = buildArticleJsonLd({
    title: guide.frontmatter.title,
    description: guide.frontmatter.description,
    path: `/guides/${guide.frontmatter.slug}`,
    locale: safeLocale,
  })

  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-12 md:px-8 md:py-16">
      <article className="space-y-8">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify({
              ...articleJsonLd,
              datePublished: guide.frontmatter.publishedAt,
              ...(guide.frontmatter.updatedAt
                ? { dateModified: guide.frontmatter.updatedAt }
                : {}),
            }),
          }}
        />
        <header className="space-y-4">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            {guide.frontmatter.title}
          </h1>
          <p className="text-base leading-8 text-muted-foreground md:text-lg">
            {guide.frontmatter.description}
          </p>
        </header>
        <div className="prose prose-neutral max-w-none prose-headings:scroll-mt-24 prose-a:break-words dark:prose-invert">
          {content}
        </div>
        {guide.frontmatter.faq && guide.frontmatter.faq.length > 0 && (
          <FaqBlock questions={guide.frontmatter.faq} />
        )}
      </article>
    </main>
  )
}
