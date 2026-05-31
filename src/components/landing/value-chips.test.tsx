// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../messages/zh-TW.json'
import type { TaxonomyTag } from '@/lib/types'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}))

import ValueChips from './value-chips'

function renderWithZhTW(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

const mockTags: TaxonomyTag[] = [
  { id: '1', slug: 'sustainable', name: 'Sustainable', nameZh: '永續經營', category: 'value', isActive: true, suggestedBy: null, createdAt: '2024-01-01' },
  { id: '2', slug: 'handmade', name: 'Handmade', nameZh: '手工製作', category: 'value', isActive: true, suggestedBy: null, createdAt: '2024-01-01' },
  { id: '3', slug: 'local-ingredients', name: 'Local Ingredients', nameZh: '在地食材', category: 'value', isActive: true, suggestedBy: null, createdAt: '2024-01-01' },
]

describe('ValueChips', () => {
  it('renders tag names as chip links', () => {
    renderWithZhTW(<ValueChips tags={mockTags} />)

    expect(screen.getByText('永續經營')).toBeInTheDocument()
    expect(screen.getByText('手工製作')).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /永續經營/ })
    expect(link).toHaveAttribute('href', '/brands?tags=sustainable')
  })

  it('renders nothing when tags is empty', () => {
    const { container } = renderWithZhTW(<ValueChips tags={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
