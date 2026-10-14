import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MDXRemote } from 'next-mdx-remote/rsc'

import { StoryContent } from '@/app/[locale]/(site)/stories/[slug]/story-content'

import { createStoryComponentMap, remarkTrailSections } from './components'

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
    expect(html).not.toContain('<p class="prose-measure my-4 type-body"><p')
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

describe('trail MDX rendering', () => {
  // `<section id="…">` is explicit lowercase JSX, which MDX never resolves
  // against the component map. `remarkTrailSections` renames it so the rail
  // layout (EL-09) can reach it; this proves the rename survives compilation.
  it('routes an authored <section> through the TrailSection rail layout', async () => {
    const renderedContent = await MDXRemote({
      source: [
        '<section id="paper">',
        '',
        '## 留在桌上的紙',
        '',
        '紙的段落。',
        '',
        '<TrailProducts section="paper" />',
        '',
        '</section>',
      ].join('\n'),
      options: {
        blockJS: false,
        blockDangerousJS: true,
        mdxOptions: { remarkPlugins: [remarkTrailSections] },
      },
      components: createStoryComponentMap({
        trailSections: [{ key: 'paper', title: '留在桌上的紙' }],
      }),
    })
    const html = renderToStaticMarkup(renderedContent)

    expect(html).toContain('<section id="paper"')
    expect(html).toContain('data-slot="trail-rail"')
    expect(html).toContain('data-slot="trail-prose"')
    expect(html).toContain('留在桌上的紙')
  })
})
