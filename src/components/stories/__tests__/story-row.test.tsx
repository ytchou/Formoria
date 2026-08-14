// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'

import zh from '../../../../messages/zh-TW.json'
import type { StoryEntry } from '@/lib/services/stories'
import { StoryRow } from '../story-row'

const story: StoryEntry = {
  slug: 'reading-corner',
  frontmatter: {
    title: 'Reading corner',
    description: 'A story about making room to read.',
    slug: 'reading-corner',
    tags: ['home'],
    locale: 'zh-TW',
    publishedAt: '2026-08-15T00:00:00.000Z',
    draft: false,
    sources: [],
    faq: [],
  },
}

function renderRow(hrefBase?: string) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      <StoryRow
        story={story}
        locale="zh-TW"
        headingLevel={2}
        hrefBase={hrefBase}
        namespace={hrefBase ? 'discover' : undefined}
      />
    </NextIntlClientProvider>,
  )
}

describe('StoryRow', () => {
  it('honours hrefBase while keeping the default story route', () => {
    const { rerender } = renderRow('/discover')
    expect(screen.getByRole('link')).toHaveAttribute('href', '/discover/reading-corner')

    rerender(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <StoryRow story={story} locale="zh-TW" headingLevel={2} />
      </NextIntlClientProvider>,
    )
    expect(screen.getByRole('link')).toHaveAttribute('href', '/stories/reading-corner')
  })
})
