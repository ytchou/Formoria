// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { PendingEditsList } from '../pending-edits-list'
import messages from '../../../../messages/en.json'

vi.mock('@/app/admin/actions', () => ({
  approvePendingEditAction: vi.fn().mockResolvedValue(undefined),
  rejectPendingEditAction: vi.fn().mockResolvedValue(undefined),
}))

const EDITS = [
  {
    id: 'edit-1',
    brand: {
      id: 'b1',
      name: 'Warm Wood Home',
      slug: 'wanjia',
      description: 'Original description',
      city: null,
      heroImageUrl: null,
      category: null,
      contactEmail: 'owner@example.com',
      foundingYear: 2020,
      mitStory: null,
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
      purchaseWebsite: null,
      purchasePinkoi: null,
      purchaseShopee: null,
      otherUrls: [],
      retailLocations: [],
      productPhotos: [],
      siteContent: null,
      priceRange: null,
      productTags: [],
      descriptionEn: null,
      blurb: null,
    },
    submittedBy: 'user-1',
    brandId: 'b1',
    createdAt: '2026-06-12T10:00:00Z',
    updatedAt: '2026-06-12T10:00:00Z',
    status: 'pending' as const,
    proposedData: { name: 'Warm Wood Home Updated', description: 'New description' },
    reviewerNotes: null,
    reviewedAt: null,
    reviewedBy: null,
  },
]

it('renders a row per pending edit', () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PendingEditsList edits={EDITS} />
    </NextIntlClientProvider>,
  )
  expect(screen.getByText('Warm Wood Home')).toBeInTheDocument()
})

it('expands to show diff view on Expand click', async () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PendingEditsList edits={EDITS} />
    </NextIntlClientProvider>,
  )
  fireEvent.click(screen.getByText('Expand'))
  expect(await screen.findByText('Current version')).toBeInTheDocument()
  expect(await screen.findByText('Proposed change')).toBeInTheDocument()
})

it('shows reject note input when Reject is clicked', async () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PendingEditsList edits={EDITS} />
    </NextIntlClientProvider>,
  )
  fireEvent.click(screen.getByText('Expand'))
  fireEvent.click(await screen.findByText('Reject'))
  expect(await screen.findByPlaceholderText(/Rejection reason/)).toBeInTheDocument()
})

describe('PendingEditsList', () => {
  it('shows empty state when no edits', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PendingEditsList edits={[]} />
      </NextIntlClientProvider>,
    )
    expect(screen.getByText('No pending brand edits.')).toBeInTheDocument()
  })

  it('shows cancel button after clicking Reject', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PendingEditsList edits={EDITS} />
      </NextIntlClientProvider>,
    )
    fireEvent.click(screen.getByText('Expand'))
    fireEvent.click(await screen.findByText('Reject'))
    expect(await screen.findByText('Cancel')).toBeInTheDocument()
    expect(await screen.findByText('Confirm reject')).toBeInTheDocument()
  })

  it('collapses reject note on Cancel click', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PendingEditsList edits={EDITS} />
      </NextIntlClientProvider>,
    )
    fireEvent.click(screen.getByText('Expand'))
    fireEvent.click(await screen.findByText('Reject'))
    fireEvent.click(await screen.findByText('Cancel'))
    expect(screen.queryByPlaceholderText(/Rejection reason/)).not.toBeInTheDocument()
  })
})
