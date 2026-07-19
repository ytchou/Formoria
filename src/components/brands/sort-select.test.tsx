/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import zh from '../../../messages/zh-TW.json'
import { SortSelect } from './sort-select'

vi.mock('@/hooks/use-filter-params', () => ({
  useFilterParams: () => ({
    currentSort: 'random',
    setSort: vi.fn(),
  }),
}))

describe('SortSelect', () => {
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
})
