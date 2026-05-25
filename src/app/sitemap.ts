import type { MetadataRoute } from 'next'
import { getAllBrandSlugs } from '@/lib/services/brands'
import { getActiveCategories } from '@/lib/services/taxonomy'

export const revalidate = 86400 // 24hr ISR

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: siteUrl,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${siteUrl}/brands`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${siteUrl}/faq`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${siteUrl}/terms`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${siteUrl}/support`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ]

  try {
    const [brandSlugs, categories] = await Promise.all([
      getAllBrandSlugs(),
      getActiveCategories(),
    ])

    const brandPages: MetadataRoute.Sitemap = brandSlugs.map((slug) => ({
      url: `${siteUrl}/brands/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }))

    const categoryPages: MetadataRoute.Sitemap = categories.map(({ slug }) => ({
      url: `${siteUrl}/categories/${slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    }))

    return [...staticPages, ...brandPages, ...categoryPages]
  } catch {
    // Fallback: static pages only (DB unavailable)
    return staticPages
  }
}
