// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'

import enMessages from '../../../../messages/en.json'
import { LocaleSwitcher } from '@/components/i18n/locale-switcher'
import { trackLanguageSwitched } from '@/lib/analytics'

vi.mock('@/lib/analytics', () => ({
  trackLanguageSwitched: vi.fn(),
}))

vi.mock('@/app/actions/locale-preference', () => ({
  setLocalePreference: vi.fn(),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    locale,
    ...rest
  }: {
    children: React.ReactNode
    href: string
    locale?: string
    [key: string]: unknown
  }) => (
    <a href={locale ? `/${locale}${href}` : href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/',
}))

function renderAt(locale: string) {
  return render(
    <NextIntlClientProvider locale={locale} messages={enMessages}>
      <LocaleSwitcher />
    </NextIntlClientProvider>,
  )
}

describe('LocaleSwitcher', () => {
  it('opens a language menu with persisted locale actions', async () => {
    const user = userEvent.setup()

    renderAt('zh-TW')

    await user.click(screen.getByRole('button', { name: 'Switch language' }))

    expect((await screen.findAllByRole('menuitem', { name: 'Traditional Chinese' })).length).toBeGreaterThan(0)
    expect((await screen.findAllByRole('menuitem', { name: 'English' })).length).toBeGreaterThan(0)
  })

  it('calls trackLanguageSwitched when a locale option is clicked', async () => {
    const user = userEvent.setup()

    renderAt('zh-TW')

    await user.click(screen.getByRole('button', { name: 'Switch language' }))
    const englishOption = (await screen.findAllByRole('menuitem', { name: 'English' }))[0]
    await user.click(englishOption!)

    expect(trackLanguageSwitched).toHaveBeenCalledWith('zh-TW', 'en', 'header')
  })
})
