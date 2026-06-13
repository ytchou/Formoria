// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DashboardQueueItem } from '../dashboard-queue-item'

describe('DashboardQueueItem', () => {
  it('renders label and date', () => {
    render(
      <DashboardQueueItem
        label="好丘 Goodchos"
        date="2026-06-13"
        onApprove={vi.fn().mockResolvedValue(undefined)}
      />
    )
    expect(screen.getByText('好丘 Goodchos')).toBeInTheDocument()
    expect(screen.getByText('2026-06-13')).toBeInTheDocument()
  })

  it('renders approve button and calls onApprove when clicked', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined)
    render(<DashboardQueueItem label="好丘 Goodchos" date="2026-06-13" onApprove={onApprove} />)
    const approveBtn = screen.getByRole('button', { name: /核准|Approve/i })
    await userEvent.click(approveBtn)
    expect(onApprove).toHaveBeenCalledTimes(1)
  })

  it('renders sublabel when provided', () => {
    render(
      <DashboardQueueItem
        label="好丘 Goodchos"
        sublabel="user@example.com"
        date="2026-06-13"
        onApprove={vi.fn().mockResolvedValue(undefined)}
      />
    )
    expect(screen.getByText('user@example.com')).toBeInTheDocument()
  })

  it.each([
    ['high', '高風險'],
    ['medium', '中風險'],
    ['clean', '通過'],
  ] as const)('shows localized %s risk badge', (riskLevel, label) => {
    render(
      <DashboardQueueItem
        label="好丘 Goodchos"
        date="2026-06-13"
        riskLevel={riskLevel}
        onApprove={vi.fn().mockResolvedValue(undefined)}
      />
    )
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('disables approve button while pending', () => {
    render(
      <DashboardQueueItem
        label="好丘 Goodchos"
        date="2026-06-13"
        onApprove={vi.fn().mockResolvedValue(undefined)}
        isPending
      />
    )
    expect(screen.getByRole('button', { name: /核准|Approve/i })).toBeDisabled()
  })
})
