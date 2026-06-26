// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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

  it('renders nothing when phaseResults is undefined', () => {
    const { container } = render(<PhaseBadges phaseResults={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when phaseResults is empty', () => {
    const { container } = render(<PhaseBadges phaseResults={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
