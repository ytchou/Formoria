import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MDXRemote } from 'next-mdx-remote/rsc'

import { StoryContent } from '@/app/[locale]/(site)/stories/[slug]/story-content'

describe('story MDX rendering', () => {
  it('passes evaluated expression attributes to story shortcodes', async () => {
    const mdxElement = StoryContent({
      source: '<StatsCallout stat={"12,480"} label={"Monthly active visitors"} />',
    })

    const renderedContent = await MDXRemote(mdxElement.props)
    const html = renderToStaticMarkup(renderedContent)

    expect(html).toContain('12,480')
    expect(html).toContain('Monthly active visitors')
  })
})
