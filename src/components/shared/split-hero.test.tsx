// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/image', () => ({
  default: ({ alt = '', fill, priority, ...props }: Record<string, unknown>) => {
    void fill
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={String(alt)} data-priority={priority ? 'true' : undefined} {...props} />
    )
  },
}))

import SplitHero from './split-hero'

describe('SplitHero', () => {
  it('renders the heading, subtitle, and slot content', () => {
    render(
      <SplitHero
        imageSrc="/images/test-hero.png"
        eyebrow="Eyebrow"
        headline="Main heading"
        subheadline="Supporting subtitle"
      >
        <button type="button">Explore brands</button>
      </SplitHero>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Main heading' })).toBeInTheDocument()
    expect(screen.getByText('Supporting subtitle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Explore brands' })).toBeInTheDocument()
    expect(document.querySelector('img')).toHaveAttribute('data-priority', 'true')
  })
})
