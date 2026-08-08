// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import enMessages from '../../../../messages/en.json'
import type { Event } from '@/lib/services/events'
import type { StoryEntry } from '@/lib/services/stories'

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl')
  const messages = (await import('../../../../messages/en.json')).default
  type TranslatorOptions = Parameters<typeof createTranslator>[0]
  return {
    getLocale: async () => 'en',
    getTranslations: async (options?: { locale?: string; namespace?: string }) =>
      createTranslator({
        locale: options?.locale ?? 'en',
        messages,
        namespace: options?.namespace,
      } as unknown as TranslatorOptions),
  }
})

import { EventInfo } from '../event-info'

const event = {
  name: 'Taiwan Creative Expo',
  nameEn: 'Taiwan Creative Expo',
  startsOn: '2026-08-06',
  endsOn: '2026-08-12',
  scheduleNote: 'Trade days\nPublic days',
  scheduleNoteEn: 'Trade days\nPublic days',
  venueName: 'TaiNEX 1',
  venueNameEn: 'TaiNEX 1',
  venueAddress: 'Taipei',
  admissionNote: 'Free entry',
  admissionNoteEn: 'Free entry',
  officialUrl: 'https://example.com',
  ticketUrl: 'https://example.com/book',
} as unknown as Event

const seriesEntry = (slug: string, title: string) =>
  ({ slug, frontmatter: { title } }) as StoryEntry

function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

const loadEvent = vi.fn(async () => event)
const loadSeries = vi.fn(async () => ({
  ok: true as const,
  stories: [seriesEntry('one', 'First'), seriesEntry('two', 'Second')],
}))

describe('EventInfo', () => {
  it('renders event information and the series list in one card', async () => {
    renderWithIntl(
      await EventInfo({
        slug: 'expo',
        currentStorySlug: 'one',
        loadEvent,
        loadSeries,
      }),
    )

    // The event name is a heading at the same level as the series heading below
    // it — the two halves of the card are peers, not parent and child.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Taiwan Creative Expo' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Dates')).toBeInTheDocument()
    expect(screen.getByText('2026/08/06 – 08/12')).toBeInTheDocument()
    expect(screen.getByText('TaiNEX 1')).toBeInTheDocument()
    // The street address belongs on the event page, not in an in-story summary.
    expect(screen.queryByText('Taipei')).toBeNull()
    expect(screen.getByText('Free entry')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Event page' })).toHaveAttribute(
      'href',
      '/en/events/expo',
    )
  })

  it('renders the series when the event is missing', async () => {
    renderWithIntl(
      await EventInfo({
        slug: 'expo',
        loadEvent: async () => null,
        loadSeries,
      }),
    )
    expect(screen.getByText('In this series')).toBeInTheDocument()
    expect(screen.queryByText('Dates')).toBeNull()
  })

  it('renders only event information for a one-story series', async () => {
    renderWithIntl(
      await EventInfo({
        slug: 'expo',
        loadEvent,
        loadSeries: async () => ({
          ok: true as const,
          stories: [seriesEntry('one', 'First')],
        }),
      }),
    )
    expect(screen.getByText('Dates')).toBeInTheDocument()
    expect(screen.queryByText('In this series')).toBeNull()
  })

  it('renders nothing when both data sources are empty', async () => {
    const { container } = renderWithIntl(
      await EventInfo({
        slug: 'expo',
        loadEvent: async () => null,
        loadSeries: async () => ({ ok: true as const, stories: [] }),
      }),
    )
    expect(container).toBeEmptyDOMElement()
  })

  // `scheduleNote` is authored one line per day band, and those bands are the
  // safety-critical part: a reader who sees them collapsed into one paragraph
  // can turn up on a trade-buyer-only day. The newline must survive into the
  // DOM *and* the element must carry `whitespace-pre-line` to render it.
  it('preserves schedule note newlines', async () => {
    renderWithIntl(await EventInfo({ slug: 'expo', loadEvent, loadSeries }))

    const note = screen.getByText(/Trade days/)
    expect(note.textContent).toBe('Trade days\nPublic days')
    expect(note).toHaveClass('whitespace-pre-line')
  })
})
