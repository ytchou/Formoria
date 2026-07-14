// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '../status-badge'

describe('StatusBadge', () => {
  it('renders pending status with correct text', () => {
    render(<StatusBadge status="pending" />)
    expect(screen.getByText('Pending')).toBeDefined()
  })

  it('renders approved status with correct text', () => {
    render(<StatusBadge status="approved" />)
    expect(screen.getByText('Approved')).toBeDefined()
  })

  it('renders rejected status with correct text', () => {
    render(<StatusBadge status="rejected" />)
    expect(screen.getByText('Rejected')).toBeDefined()
  })

  it('renders hidden status with correct text', () => {
    render(<StatusBadge status="hidden" />)
    expect(screen.getByText('Hidden')).toBeDefined()
  })

  it('applies different visual styles per status', () => {
    const { rerender, container } = render(<StatusBadge status="pending" />)
    const pendingClassName = (container.firstChild as HTMLElement).className

    rerender(<StatusBadge status="approved" />)
    const approvedClassName = (container.firstChild as HTMLElement).className

    expect(pendingClassName).not.toBe(approvedClassName)
  })
})
