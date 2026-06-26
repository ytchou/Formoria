// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PhaseBadges } from '../phase-badges'
import type { PhaseResult } from '@/lib/types/curation'

const mockPhaseResults: PhaseResult[] = [
  { phase: 'clean', status: 'succeeded', changedFields: ['name'], durationMs: 12 },
  { phase: 'discover', status: 'succeeded', changedFields: [], durationMs: 0, detail: '3 URLs found' },
  { phase: 'links', status: 'succeeded', changedFields: ['social_instagram', 'purchase_website'], durationMs: 1500 },
  { phase: 'images', status: 'skipped', changedFields: [], durationMs: 0, detail: 'no image URLs' },
  { phase: 'descriptions', status: 'failed', changedFields: [], durationMs: 3200, error: 'AI rewrite timeout' },
]

describe('PhaseBadges', () => {
  it('renders a badge for each phase result', () => {
    render(<PhaseBadges phaseResults={mockPhaseResults} />)
    expect(screen.getByText('清理')).toBeInTheDocument()
    expect(screen.getByText('搜尋')).toBeInTheDocument()
    expect(screen.getByText('連結')).toBeInTheDocument()
    expect(screen.getByText('圖片')).toBeInTheDocument()
    expect(screen.getByText('描述')).toBeInTheDocument()
  })

  it('applies status color classes to succeeded, skipped, and failed badges', () => {
    render(<PhaseBadges phaseResults={mockPhaseResults} />)

    expect(screen.getByText('清理')).toHaveClass('bg-verified-green-bg', 'text-verified-green')
    expect(screen.getByText('圖片')).toHaveClass('bg-[#F5F4F1]', 'text-[#6B6560]')
    expect(screen.getByText('描述')).toHaveClass('bg-destructive/10', 'text-destructive')
  })

  it('shows phase details when hovering a badge', async () => {
    const user = userEvent.setup()
    render(<PhaseBadges phaseResults={mockPhaseResults} />)

    await user.click(screen.getByText('描述'))

    expect(await screen.findByText('AI rewrite timeout')).toBeInTheDocument()
  })

  it('renders nothing when phaseResults is undefined', () => {
    const { container } = render(<PhaseBadges phaseResults={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when phaseResults is empty', () => {
    const { container } = render(<PhaseBadges phaseResults={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
