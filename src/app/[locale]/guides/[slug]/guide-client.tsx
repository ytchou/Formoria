'use client'

import { TinaMarkdown, type TinaMarkdownContent } from 'tinacms/dist/rich-text'
import { useTina } from 'tinacms/react'

import { tinaComponentMap } from '@/lib/mdx/components'

type GuideTinaData = {
  guide?: {
    body?: unknown
  } | null
}

type GuideClientProps = {
  data: GuideTinaData
  query?: string
  variables?: Record<string, unknown>
}

export function GuideClient({ data, query, variables }: GuideClientProps) {
  const tinaData = useTina({
    data,
    query: query ?? '',
    variables: variables ?? {},
  })

  if (!tinaData.data.guide?.body) {
    return null
  }

  return (
    <TinaMarkdown
      content={tinaData.data.guide.body as TinaMarkdownContent | TinaMarkdownContent[]}
      components={tinaComponentMap}
    />
  )
}
