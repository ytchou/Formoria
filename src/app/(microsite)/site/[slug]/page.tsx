import { createElement } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getBrandBySlug, getMicrositeSlugs } from '@/lib/services/brands'
import { getTemplate } from '@/components/microsite/templates/registry'
import { isMicrositeEnabled, micrositeMetadata } from './microsite-helpers'

export const revalidate = 60
export const dynamicParams = true

export async function generateStaticParams() {
  try {
    const slugs = await getMicrositeSlugs()
    return slugs.map((slug) => ({ slug }))
  } catch {
    return []
  }
}

type PageProps = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params

  try {
    const brand = await getBrandBySlug(slug)
    if (!isMicrositeEnabled(brand)) return {}
    return micrositeMetadata(brand)
  } catch {
    return {}
  }
}

export default async function MicrositePage({ params }: PageProps) {
  const { slug } = await params

  let brand
  try {
    brand = await getBrandBySlug(slug)
  } catch {
    notFound()
  }

  if (!isMicrositeEnabled(brand) || !brand.siteContent) {
    notFound()
  }

  const siteContent = brand.siteContent
  const Template = getTemplate(siteContent.template)

  return createElement(Template, { brand, siteContent })
}
