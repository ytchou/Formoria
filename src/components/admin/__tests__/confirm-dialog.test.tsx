// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import type { ComponentProps } from 'react'
import messages from '../../../../messages/en.json'
import { ConfirmDialog } from '../confirm-dialog'

// Cancel and the pending label come from `admin.common`, so the dialog needs
// the message provider the admin layout mounts around it in the app.
function renderDialog(props: ComponentProps<typeof ConfirmDialog>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ConfirmDialog {...props} />
    </NextIntlClientProvider>,
  )
}

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Delete Brand',
    description: 'This action cannot be undone.',
    onConfirm: vi.fn(),
    confirmLabel: 'Delete',
    variant: 'destructive' as const,
  }

  it('renders title and description when open', () => {
    renderDialog(defaultProps)
    expect(screen.getByText('Delete Brand')).toBeDefined()
    expect(screen.getByText('This action cannot be undone.')).toBeDefined()
  })

  it('renders confirm button with correct label', () => {
    renderDialog(defaultProps)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDefined()
  })

  it('renders cancel button', () => {
    renderDialog(defaultProps)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()
  })

  it('calls onConfirm when confirm button is clicked', () => {
    renderDialog(defaultProps)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(defaultProps.onConfirm).toHaveBeenCalledOnce()
  })

  it('shows confirmation input when confirmText is provided', () => {
    renderDialog({ ...defaultProps, confirmText: 'My Brand' })
    expect(screen.getByPlaceholderText('Type "My Brand" to confirm')).toBeDefined()
  })

  it('disables confirm button until confirmText matches', () => {
    renderDialog({ ...defaultProps, confirmText: 'My Brand' })
    const confirmBtn = screen.getByRole('button', { name: 'Delete' })
    expect(confirmBtn).toHaveProperty('disabled', true)

    const input = screen.getByPlaceholderText('Type "My Brand" to confirm')
    fireEvent.change(input, { target: { value: 'My Brand' } })
    expect(confirmBtn).toHaveProperty('disabled', false)
  })

  // A destructive confirmation is a one-way door: the cheapest keystroke must
  // never be the one that deletes something, so focus starts on Cancel and
  // Escape is refused.
  it('variant="destructive" arms the destructive dialog behavior', async () => {
    const onOpenChange = vi.fn()
    renderDialog({ ...defaultProps, onOpenChange, variant: 'destructive' })

    const cancel = screen.getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(document.activeElement).toBe(cancel))

    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByText('Delete Brand')).toBeDefined()
  })

  it('variant="primary" leaves dismissal alone', async () => {
    const onOpenChange = vi.fn()
    renderDialog({
      ...defaultProps,
      onOpenChange,
      variant: 'primary',
      confirmLabel: 'Approve',
    })

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
