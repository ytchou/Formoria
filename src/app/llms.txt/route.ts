import { getSiteUrl } from '@/lib/seo/site-url'
import { getActiveCategories } from '@/lib/services/taxonomy'

export const revalidate = 3600

function formatCategoryLabel(category: { name: string; nameZh: string | null }): string {
  return category.nameZh ? `${category.nameZh} / ${category.name}` : category.name
}

export async function GET() {
  const base = getSiteUrl()
  const categories = await getActiveCategories()

  const links = [
    `- [Brands](${base}/brands)`,
    ...categories.map(
      (category) => `- [${formatCategoryLabel(category)}](${base}/brands?category=${category.slug})`
    ),
    `- [About](${base}/about)`,
    `- [Glossary](${base}/glossary)`,
  ]

  const body = [
    '# Formoria',
    '',
    'Formoria is a community-curated Made in Taiwan brand directory, built for bilingual discovery in zh-TW and English.',
    '',
    '## Links',
    ...links,
    '',
  ].join('\n')

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
