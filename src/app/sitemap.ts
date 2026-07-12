import type { MetadataRoute } from 'next'
import { getAllBrandSlugs } from '@/lib/services/brands'
import { getAllGuides } from '@/lib/services/guides'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { buildAlternates } from '@/lib/seo/alternates'
import { getSiteUrl } from '@/lib/seo/site-url'

export const revalidate = 3600 // 1hr ISR

function makeEntry(
  path: string,
  now: Date,
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'],
  priority: number
): MetadataRoute.Sitemap[number] {
  const base = getSiteUrl()
  const { languages } = buildAlternates(path, 'zh-TW')
  const normalizedPath = path === '' || path === '/' ? '' : `/${path.replace(/^\//, '')}`
  // Sitemap canonical = zh-TW (prefix-free) URL
  const url = `${base}${normalizedPath}`
  return {
    url,
    lastModified: now,
    changeFrequency,
    priority,
    alternates: {
      languages: {
        'zh-TW': languages['zh-TW'],
        en: languages['en'],
      },
    },
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    makeEntry('/', now, 'daily', 1.0),
    makeEntry('/brands', now, 'weekly', 0.9),
    makeEntry('/stats', now, 'weekly', 0.6),
    makeEntry('/about', now, 'monthly', 0.5),
    makeEntry('/glossary', now, 'monthly', 0.5),
    makeEntry('/faq', now, 'monthly', 0.5),
    makeEntry('/terms', now, 'monthly', 0.5),
    makeEntry('/privacy', now, 'monthly', 0.5),
    makeEntry('/guides', now, 'weekly', 0.7),
    makeEntry('/getting-started', now, 'monthly', 0.6),
    makeEntry('/submit', now, 'monthly', 0.4),
  ]

  try {
    const brandSlugs = await getAllBrandSlugs()
    const guides = await getAllGuides()

    const brandPages: MetadataRoute.Sitemap = brandSlugs.map((slug) =>
      makeEntry(`/brands/${slug}`, now, 'weekly', 0.8)
    )
    const guidePages: MetadataRoute.Sitemap = guides.map((guide) =>
      makeEntry(
        `/guides/${guide.frontmatter.slug}`,
        new Date(guide.frontmatter.updatedAt || guide.frontmatter.publishedAt),
        'weekly',
        0.7
      )
    )
    const categoryPages: MetadataRoute.Sitemap = PRODUCT_TYPE_CATEGORIES.map((cat) =>
      makeEntry(`/brands?category=${cat.slug}`, now, 'weekly', 0.8)
    )

    return [...staticPages, ...categoryPages, ...brandPages, ...guidePages]
  } catch {
    // Fallback: static pages only (DB unavailable)
    return staticPages
  }
}
