// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'

import enMessages from '../../../../messages/en.json'
import { LocaleSwitcher } from '@/components/i18n/locale-switcher'

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
  it('opens a language menu linking to each locale', async () => {
    const user = userEvent.setup()

    renderAt('zh-TW')

    await user.click(screen.getByRole('button', { name: 'Switch language' }))

    // Base UI renders menu items with role="menuitem" (and duplicates them across an
    // inert layer), so query the underlying anchors directly. Active-locale aria-current
    // is verified in the real DOM / e2e, not reproducible under the jsdom Link mock.
    await screen.findAllByText('中文')
    const anchors = Array.from(document.querySelectorAll('a'))
    const zhLink = anchors.find((a) => a.textContent === '中文')
    const enLink = anchors.find((a) => a.textContent === 'English')

    expect(zhLink).toHaveAttribute('href', '/zh-TW/')
    expect(enLink).toHaveAttribute('href', '/en/')
  })
})
