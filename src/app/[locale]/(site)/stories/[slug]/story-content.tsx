import { MDXRemote } from 'next-mdx-remote/rsc'

import { storyComponentMap } from '@/lib/mdx/components'

type StoryContentProps = {
  source: string
}

export function StoryContent({ source }: StoryContentProps) {
  return (
    <MDXRemote
      source={source}
      options={{ blockJS: false, blockDangerousJS: true }}
      components={storyComponentMap}
    />
  )
}
