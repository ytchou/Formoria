import type { Metadata } from 'next'
import { NotFoundPage } from '@/components/not-found-page'
import { buildNotFoundMetadata } from '@/lib/seo/not-found-metadata'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale?: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return buildNotFoundMetadata(locale)
}

export default function StoryNotFound() {
  return <NotFoundPage />
}
