// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DirectoryFilterToken } from './directory-filter-token'

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe('DirectoryFilterToken', () => {
  it('renders a full-width removable row with a 48px target', () => {
    render(
      <DirectoryFilterToken
        href="/brands?category=jewelry"
        label="Brand search"
        removeLabel="Remove brand search herbs"
        value="herbs"
        variant="row"
      />,
    )

    const token = screen.getByRole('link', {
      name: 'Remove brand search herbs',
    })
    expect(token).toHaveAttribute('href', '/brands?category=jewelry')
    expect(token).toHaveClass('min-h-12', 'w-full')
    expect(token).toHaveTextContent('Brand search: herbs')
  })

  it('renders the compact chip presentation', () => {
    render(
      <DirectoryFilterToken
        href="/brands?search=herbs"
        label="Category"
        removeLabel="Remove category Jewelry"
        value="Jewelry"
        variant="chip"
      />,
    )

    const token = screen.getByRole('link', {
      name: 'Remove category Jewelry',
    })
    expect(token).toHaveClass('rounded-full')
  })
})
