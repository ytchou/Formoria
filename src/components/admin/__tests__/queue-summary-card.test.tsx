// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueueSummaryCard } from '../queue-summary-card'

describe('QueueSummaryCard', () => {
  it('renders title and count', () => {
    render(
      <QueueSummaryCard title="Pending Submissions" count={3} href="/admin/submissions" emptyMessage="No pending submissions">
        <div>item content</div>
      </QueueSummaryCard>
    )
    expect(screen.getByText('Pending Submissions')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders View all link with correct href', () => {
    render(
      <QueueSummaryCard title="Pending Submissions" count={3} href="/admin/submissions" emptyMessage="No pending submissions">
        <div>item</div>
      </QueueSummaryCard>
    )
    const link = screen.getByRole('link', { name: 'View all →' })
    expect(link).toHaveAttribute('href', '/admin/submissions')
  })

  it('shows empty message when count is 0', () => {
    render(
      <QueueSummaryCard title="Pending Submissions" count={0} href="/admin/submissions" emptyMessage="No pending submissions" />
    )
    expect(screen.getByText('No pending submissions')).toBeInTheDocument()
  })

  it('renders children when count > 0', () => {
    render(
      <QueueSummaryCard title="Pending Submissions" count={2} href="/admin/submissions" emptyMessage="No pending submissions">
        <div data-testid="child-item">Brand A</div>
      </QueueSummaryCard>
    )
    expect(screen.getByTestId('child-item')).toBeInTheDocument()
  })
})
