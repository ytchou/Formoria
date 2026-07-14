// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmDialog } from '../confirm-dialog'

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
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByText('Delete Brand')).toBeDefined()
    expect(screen.getByText('This action cannot be undone.')).toBeDefined()
  })

  it('renders confirm button with correct label', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDefined()
  })

  it('renders cancel button', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()
  })

  it('calls onConfirm when confirm button is clicked', () => {
    render(<ConfirmDialog {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(defaultProps.onConfirm).toHaveBeenCalledOnce()
  })

  it('shows confirmation input when confirmText is provided', () => {
    render(<ConfirmDialog {...defaultProps} confirmText="My Brand" />)
    expect(screen.getByPlaceholderText('Type "My Brand" to confirm')).toBeDefined()
  })

  it('disables confirm button until confirmText matches', () => {
    render(<ConfirmDialog {...defaultProps} confirmText="My Brand" />)
    const confirmBtn = screen.getByRole('button', { name: 'Delete' })
    expect(confirmBtn).toHaveProperty('disabled', true)

    const input = screen.getByPlaceholderText('Type "My Brand" to confirm')
    fireEvent.change(input, { target: { value: 'My Brand' } })
    expect(confirmBtn).toHaveProperty('disabled', false)
  })
})
