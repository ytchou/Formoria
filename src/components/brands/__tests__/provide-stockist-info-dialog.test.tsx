// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../../messages/zh-TW.json'

vi.mock('@/app/[locale]/(site)/brands/[slug]/actions', () => ({
  submitStockistInfoAction: vi.fn(),
}))

vi.mock('@/lib/auth/use-user', () => ({
  useUser: () => ({ user: { id: 'user-uuid-1' }, loading: false }),
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/brands/test-brand',
}))

// The form state is what selects the branch under test, so it is the mock's
// only knob; the dispatch and pending flag never vary here.
const actionState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useActionState: vi.fn(() => [actionState.current, vi.fn(), false]),
  }
})

import { ProvideStockistInfoDialog } from '../provide-stockist-info-dialog'

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      <ProvideStockistInfoDialog brandId="b1" brandSlug="test-brand" />
    </NextIntlClientProvider>
  )
}

async function openDialog() {
  const user = userEvent.setup()
  renderDialog()
  await user.click(screen.getByRole('button', { name: /提供實體通路/ }))
  return screen.getByRole('dialog')
}

describe('ProvideStockistInfoDialog', () => {
  beforeEach(() => {
    actionState.current = {}
  })

  it('header stays pinned while the body scrolls', async () => {
    const dialog = await openDialog()

    const content = dialog.closest('[data-slot="dialog-content"]') ?? dialog
    const body = dialog.querySelector('[data-slot="dialog-body"]')
    const header = dialog.querySelector('[data-slot="dialog-header"]')

    expect(header).not.toBeNull()
    expect(body).not.toBeNull()
    // The body is the only scroll container; the popup itself must not scroll,
    // or the header and the footer leave the screen with the content.
    expect(body?.className).toContain('overflow-y-auto')
    expect(body?.className).toContain('min-h-0')
    expect(content.className).not.toContain('overflow-y-auto')
    // The header is outside the scroll container, not a child of it.
    expect(body?.contains(header)).toBe(false)
    // The size axis is a prop, and the call site sets no width of its own.
    expect(content.getAttribute('data-size')).toBe('form')
    // The only surviving `max-w` is the shell's own edge gutter, and the only
    // `max-h` is the shell's `85dvh` cap — the call site's `sm:max-w-lg` and
    // `max-h-[calc(100dvh-2rem)]` are gone.
    expect(content.className).not.toContain('max-w-lg')
    expect(content.className).not.toContain('100dvh')
    expect(content.className).toContain('max-h-[85dvh]')
    expect(content.className).toContain('grid-rows-[auto_minmax(0,1fr)]')
  })

  it('success state renders through DialogStatus', async () => {
    actionState.current = { success: true }
    const dialog = await openDialog()

    const status = dialog.querySelector('[data-slot="dialog-status"]')
    expect(status).not.toBeNull()
    expect(
      within(status as HTMLElement).getByText(/謝謝你提供/)
    ).toBeInTheDocument()

    // The close action lives in the status' own footer now, not in a
    // `DialogFooter` nested inside a padded body. `關閉` exactly — the brand
    // detail e2e spec matches this label with `exact: true`.
    const footer = status?.querySelector('[data-slot="dialog-footer"]')
    expect(footer).not.toBeNull()
    expect(
      within(footer as HTMLElement).getByRole('button', { name: '關閉' })
    ).toBeInTheDocument()

    // The form branch is gone in this state.
    expect(dialog.querySelector('[data-slot="dialog-form"]')).toBeNull()
  })

  it('region select errors are announced', async () => {
    const dialog = await openDialog()

    const region = within(dialog).getByRole('combobox', { name: /地區/ })
    expect(region).not.toHaveAttribute('aria-invalid')
    expect(region).not.toHaveAttribute('aria-describedby')

    fireEvent.invalid(region)

    expect(region).toHaveAttribute('aria-invalid', 'true')
    const describedBy = region.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()

    const message = document.getElementById(describedBy as string)
    expect(message).not.toBeNull()
    // Says how to fix it, not just that something broke.
    expect(message).toHaveTextContent('請選擇這個實體通路所在的縣市')
    expect(message).toHaveAttribute('role', 'alert')

    fireEvent.change(region, { target: { value: 'taipei' } })
    expect(region).not.toHaveAttribute('aria-invalid')
    expect(region).not.toHaveAttribute('aria-describedby')
  })
})
