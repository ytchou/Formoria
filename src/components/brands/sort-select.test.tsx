/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import zh from '../../../messages/zh-TW.json'
import { SortSelect } from './sort-select'

const mockTrackDirectorySortChanged = vi.fn()

vi.mock('@/lib/analytics', () => ({
  trackDirectorySortChanged: (...args: unknown[]) =>
    mockTrackDirectorySortChanged(...args),
}))

vi.mock('@/hooks/use-filter-params', () => ({
  useFilterParams: () => ({
    currentSort: 'random',
    setSort: vi.fn(),
  }),
}))

describe('SortSelect', () => {
  beforeEach(() => {
    mockTrackDirectorySortChanged.mockClear()
  })

  it.each([
    ['zh-TW', zh, '隨機'],
    ['en', en, 'Random'],
  ])('labels the random ordering accurately in %s', (locale, messages, label) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <SortSelect />
      </NextIntlClientProvider>,
    )

    expect(screen.getByRole('option', { name: label })).toHaveValue('random')
  })

  it('fires trackDirectorySortChanged with new and previous sort values on change', async () => {
    const user = userEvent.setup()
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SortSelect />
      </NextIntlClientProvider>,
    )

    await user.selectOptions(screen.getByRole('combobox'), 'newest')

    expect(mockTrackDirectorySortChanged).toHaveBeenCalledWith('newest', 'random')
  })
})
