// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueueSummaryCard } from '../queue-summary-card'

describe('QueueSummaryCard', () => {
  it('renders title and count', () => {
    render(
      <QueueSummaryCard title="待審核提交" count={3} href="/admin/review-queue/submissions" emptyMessage="沒有待審核的提交">
        <div>item content</div>
      </QueueSummaryCard>
    )
    expect(screen.getByText('待審核提交')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders View all link with correct href', () => {
    render(
      <QueueSummaryCard title="待審核提交" count={3} href="/admin/review-queue/submissions" emptyMessage="沒有待審核的提交">
        <div>item</div>
      </QueueSummaryCard>
    )
    const link = screen.getByRole('link', { name: /查看全部|View all/i })
    expect(link).toHaveAttribute('href', '/admin/review-queue/submissions')
  })

  it('shows empty message when count is 0', () => {
    render(
      <QueueSummaryCard title="待審核提交" count={0} href="/admin/review-queue/submissions" emptyMessage="沒有待審核的提交" />
    )
    expect(screen.getByText('沒有待審核的提交')).toBeInTheDocument()
  })

  it('renders children when count > 0', () => {
    render(
      <QueueSummaryCard title="待審核提交" count={2} href="/admin/review-queue/submissions" emptyMessage="沒有待審核的提交">
        <div data-testid="child-item">Brand A</div>
      </QueueSummaryCard>
    )
    expect(screen.getByTestId('child-item')).toBeInTheDocument()
  })
})
