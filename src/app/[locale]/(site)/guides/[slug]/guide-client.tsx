import { MDXRemote } from 'next-mdx-remote/rsc'

import { guideComponentMap } from '@/lib/mdx/components'

type GuideContentProps = {
  source: string
}

export function GuideContent({ source }: GuideContentProps) {
  return (
    <MDXRemote
      source={source}
      components={guideComponentMap}
    />
  )
}
