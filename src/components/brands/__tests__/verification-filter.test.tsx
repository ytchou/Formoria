// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../../messages/zh-TW.json'
import { VerificationFilter } from '../verification-filter'

const { mockReplace } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ replace: mockReplace })),
  usePathname: vi.fn(() => '/brands'),
  useSearchParams: vi.fn(() => new URLSearchParams('search=tea')),
}))

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('VerificationFilter', () => {
  beforeEach(() => {
    mockReplace.mockClear()
  })

  it('renders all toggles as button[data-active]', () => {
    const { container } = renderWithIntl(<VerificationFilter active="all" />)

    expect(container.querySelectorAll('button[data-active]')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: '已驗證' })).toHaveAttribute('data-active', 'false')
    expect(screen.getByRole('button', { name: '社群' })).toHaveAttribute('data-active', 'false')
  })

  it('reflects the active prop for the verified toggle', () => {
    renderWithIntl(<VerificationFilter active="verified" />)

    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('data-active', 'false')
    expect(screen.getByRole('button', { name: '已驗證' })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: '社群' })).toHaveAttribute('data-active', 'false')
  })

  it('reflects the active prop for the community toggle', () => {
    renderWithIntl(<VerificationFilter active="community" />)

    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('data-active', 'false')
    expect(screen.getByRole('button', { name: '已驗證' })).toHaveAttribute('data-active', 'false')
    expect(screen.getByRole('button', { name: '社群' })).toHaveAttribute('data-active', 'true')
  })

  it('updates the verification query param when a pill is clicked', async () => {
    const user = userEvent.setup()

    renderWithIntl(<VerificationFilter active="all" />)

    await user.click(screen.getByRole('button', { name: '已驗證' }))

    expect(mockReplace).toHaveBeenCalledWith('/brands?search=tea&verification=verified')
  })
})
