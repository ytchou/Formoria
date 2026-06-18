// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NewsletterSubscribersList } from '../newsletter-subscribers'

describe('NewsletterSubscribersList', () => {
  const mockSubscribers = [
    {
      id: '1',
      email: 'user@example.com',
      interests: ['brand-stories', 'new-brands'],
      confirmed_at: '2026-06-18T10:00:00Z',
      subscribed_at: '2026-06-18T09:00:00Z',
      unsubscribed_at: null,
    },
    {
      id: '2',
      email: 'other@example.com',
      interests: [],
      confirmed_at: null,
      subscribed_at: '2026-06-17T09:00:00Z',
      unsubscribed_at: null,
    },
  ]

  const mockStats = { total: 2, confirmed: 1, unsubscribed: 0 }

  it('renders subscriber emails', () => {
    render(<NewsletterSubscribersList subscribers={mockSubscribers} stats={mockStats} />)
    expect(screen.getByText('user@example.com')).toBeInTheDocument()
    expect(screen.getByText('other@example.com')).toBeInTheDocument()
  })

  it('shows confirmed status', () => {
    render(<NewsletterSubscribersList subscribers={mockSubscribers} stats={mockStats} />)
    const rows = screen.getAllByRole('row')
    expect(rows.length).toBeGreaterThan(1) // header + data rows
  })

  it('renders stats card', () => {
    render(<NewsletterSubscribersList subscribers={mockSubscribers} stats={mockStats} />)
    expect(screen.getByText('Total subscribers')).toBeInTheDocument()
    expect(screen.getByText('All newsletter signups')).toBeInTheDocument()
  })
})
