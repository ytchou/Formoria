import type { MetadataRoute } from 'next'
import { getSiteUrl } from '@/lib/seo/site-url'
import { CRAWLER_REGISTRY } from '@/lib/security/crawler-registry'

// Declares that AI training is disallowed while search and AI input are allowed. Next's metadata serializer cannot emit this as a robots.txt line today; convert this file to a src/app/robots.txt/route.ts Route Handler returning text/plain when the line should actually be served.
export const CONTENT_SIGNAL = 'ai-train=no, search=yes, ai-input=yes'

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl()

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api/', '/auth/', '/en/auth/', '/challenge'],
      },
      ...CRAWLER_REGISTRY.map((entry) => ({
        userAgent: entry.name,
        allow: '/',
      })),
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  }
}
