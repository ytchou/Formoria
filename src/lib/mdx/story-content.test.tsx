import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MDXRemote } from 'next-mdx-remote/rsc'

import { StoryContent } from '@/app/[locale]/(site)/stories/[slug]/story-content'

describe('story MDX rendering', () => {
  it('renders disclaimer copy without nesting paragraphs', async () => {
    const mdxElement = StoryContent({
      source: '<Disclaimer>\n  Editorial fine print.\n</Disclaimer>',
    })

    const renderedContent = await MDXRemote(mdxElement.props)
    const html = renderToStaticMarkup(renderedContent)

    expect(html).toContain('Editorial fine print.')
    // Tracks the `p` rule in `storyComponentMap`; a role rename that leaves this
    // literal behind makes the assertion pass by matching nothing.
    expect(html).not.toContain('<p class="my-4 type-body text-ink-soft"><p')
  })

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
