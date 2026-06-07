// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../../messages/zh-TW.json'
import { VerificationFilter } from '../verification-filter'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
  usePathname: vi.fn(() => '/brands'),
  useSearchParams: vi.fn(() => new URLSearchParams('search=tea')),
}))

describe('VerificationFilter', () => {
  it('renders all toggles as button[data-active]', () => {
    const { container } = render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <VerificationFilter active="all" />
      </NextIntlClientProvider>
    )

    expect(container.querySelectorAll('button[data-active]')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: '已驗證' })).toHaveAttribute('data-active', 'false')
    expect(screen.getByRole('button', { name: '社群' })).toHaveAttribute('data-active', 'false')
  })

  it('reflects the active prop for the community toggle', () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <VerificationFilter active="community" />
      </NextIntlClientProvider>
    )

    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('data-active', 'false')
    expect(screen.getByRole('button', { name: '社群' })).toHaveAttribute('data-active', 'true')
  })
})
