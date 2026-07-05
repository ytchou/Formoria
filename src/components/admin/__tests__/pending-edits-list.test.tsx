// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { PendingEditsList } from '../pending-edits-list'
import messages from '../../../../messages/zh-TW.json'

vi.mock('@/app/admin/actions', () => ({
  approvePendingEditAction: vi.fn().mockResolvedValue(undefined),
  rejectPendingEditAction: vi.fn().mockResolvedValue(undefined),
}))

const EDITS = [{
  id: 'edit-1',
  brand: {
    id: 'b1',
    name: '暖木家居',
    slug: 'wanjia',
    description: 'Original description',
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
    customerVoices: [],
    productPhotos: [],
    siteContent: null,
    priceRange: null,
    productTags: [],
  },
  submittedBy: 'user-1',
  brandId: 'b1',
  createdAt: '2026-06-12T10:00:00Z',
  updatedAt: '2026-06-12T10:00:00Z',
  status: 'pending' as const,
  proposedData: { name: '暖木家居 Updated', description: 'New description' },
  reviewerNotes: null, reviewedAt: null, reviewedBy: null,
}]

it('renders a row per pending edit', () => {
  render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <PendingEditsList edits={EDITS} />
    </NextIntlClientProvider>
  )
  expect(screen.getByText('暖木家居')).toBeInTheDocument()
})

it('expands to show diff view on 展開 click', async () => {
  render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <PendingEditsList edits={EDITS} />
    </NextIntlClientProvider>
  )
  fireEvent.click(screen.getByText('展開'))
  expect(await screen.findByText('目前版本')).toBeInTheDocument()
  expect(await screen.findByText('提案修改')).toBeInTheDocument()
})

it('shows reject note input when 退回 is clicked', async () => {
  render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <PendingEditsList edits={EDITS} />
    </NextIntlClientProvider>
  )
  fireEvent.click(screen.getByText('展開'))
  fireEvent.click(await screen.findByText('退回'))
  expect(await screen.findByPlaceholderText(/退回原因/)).toBeInTheDocument()
})

describe('PendingEditsList', () => {
  it('shows empty state when no edits', () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={messages}>
        <PendingEditsList edits={[]} />
      </NextIntlClientProvider>
    )
    expect(screen.getByText('目前沒有待審核的編輯申請。')).toBeInTheDocument()
  })

  it('shows cancel button after clicking 退回', async () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={messages}>
        <PendingEditsList edits={EDITS} />
      </NextIntlClientProvider>
    )
    fireEvent.click(screen.getByText('展開'))
    fireEvent.click(await screen.findByText('退回'))
    expect(await screen.findByText('取消')).toBeInTheDocument()
    expect(await screen.findByText('確認退回')).toBeInTheDocument()
  })

  it('collapses reject note on 取消 click', async () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={messages}>
        <PendingEditsList edits={EDITS} />
      </NextIntlClientProvider>
    )
    fireEvent.click(screen.getByText('展開'))
    fireEvent.click(await screen.findByText('退回'))
    fireEvent.click(await screen.findByText('取消'))
    expect(screen.queryByPlaceholderText(/退回原因/)).not.toBeInTheDocument()
  })
})
