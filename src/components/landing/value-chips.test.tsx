// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}))

import ValueChips from './value-chips'

const mockTags = [
  { id: '1', slug: 'sustainable', name: 'Sustainable', nameZh: '永續經營', category: 'value' as const, isActive: true },
  { id: '2', slug: 'handmade', name: 'Handmade', nameZh: '手工製作', category: 'value' as const, isActive: true },
  { id: '3', slug: 'local-ingredients', name: 'Local Ingredients', nameZh: '在地食材', category: 'value' as const, isActive: true },
]

describe('ValueChips', () => {
  it('renders tag names as chip links', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<ValueChips tags={mockTags as any} />)

    expect(screen.getByText('永續經營')).toBeInTheDocument()
    expect(screen.getByText('手工製作')).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /永續經營/ })
    expect(link).toHaveAttribute('href', '/brands?tags=sustainable')
  })

  it('renders nothing when tags is empty', () => {
    const { container } = render(<ValueChips tags={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
