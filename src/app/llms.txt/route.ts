import { getSiteUrl } from '@/lib/seo/site-url'

export const revalidate = 3600

export async function GET() {
  const base = getSiteUrl()

  const links = [
    `- [Brands](${base}/brands)`,
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
