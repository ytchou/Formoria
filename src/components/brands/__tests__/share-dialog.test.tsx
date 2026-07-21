// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import { ShareDialog } from '../share-dialog'

const analyticsMocks = vi.hoisted(() => ({
  trackBrandPageShared: vi.fn(),
}))

vi.mock('@/lib/analytics', () => ({
  trackBrandPageShared: analyticsMocks.trackBrandPageShared,
}))

const messages = {
  brandDetail: {
    share: {
      trigger: 'Share',
      dialogTitle: 'Share',
      copyLink: 'Copy Link',
      copied: 'Copied!',
      line: 'LINE',
      facebook: 'Facebook',
      x: 'X',
    },
  },
}

function renderDialog(props?: Partial<{ brandSlug: string; brandName: string; brandImageUrl: string; brandId: string }>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ShareDialog
        brandSlug={props?.brandSlug ?? 'test-brand'}
        brandName={props?.brandName ?? 'Test Brand'}
        brandImageUrl={props?.brandImageUrl}
        brandId={props?.brandId}
      />
    </NextIntlClientProvider>,
  )
}

describe('ShareDialog', () => {
  const mockWriteText = vi.fn().mockResolvedValue(undefined)
  const mockOpen = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, { clipboard: { writeText: mockWriteText } })
    vi.stubGlobal('open', mockOpen)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders share trigger button', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument()
  })

  it('shows share options when dialog opens', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /share/i }))

    await waitFor(() => {
      expect(screen.getByText('Copy Link')).toBeInTheDocument()
      expect(screen.getByText('LINE')).toBeInTheDocument()
      expect(screen.getByText('Facebook')).toBeInTheDocument()
      expect(screen.getByText('X')).toBeInTheDocument()
    })
  })

  it('shows brand name in dialog', async () => {
    renderDialog({ brandName: 'Tea Seed Tang' })
    fireEvent.click(screen.getByRole('button', { name: /share/i }))

    await waitFor(() => {
      expect(screen.getByText('Tea Seed Tang')).toBeInTheDocument()
    })
  })

  it('copies link and shows Copied! feedback', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /share/i }))

    await waitFor(() => {
      expect(screen.getByText('Copy Link')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Copy Link'))

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalled()
      expect(screen.getByText('Copied!')).toBeInTheDocument()
    })
  })

  it('opens LINE share URL in new tab', async () => {
    renderDialog({ brandSlug: 'tea-seed' })
    fireEvent.click(screen.getByRole('button', { name: /share/i }))

    await waitFor(() => {
      expect(screen.getByText('LINE')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('LINE'))

    expect(mockOpen).toHaveBeenCalledWith(
      expect.stringContaining('social-plugins.line.me'),
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('opens Facebook share URL in new tab', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /share/i }))

    await waitFor(() => {
      expect(screen.getByText('Facebook')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Facebook'))

    expect(mockOpen).toHaveBeenCalledWith(
      expect.stringContaining('facebook.com/sharer'),
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('opens X share URL in new tab', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /share/i }))

    await waitFor(() => {
      expect(screen.getByText('X')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('X'))

    expect(mockOpen).toHaveBeenCalledWith(
      expect.stringContaining('twitter.com/intent/tweet'),
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('calls trackBrandPageShared with copy_link method when Copy Link clicked', async () => {
    renderDialog({ brandSlug: 'test-brand', brandId: 'brand-id-123' })
    fireEvent.click(screen.getByRole('button', { name: /share/i }))

    await waitFor(() => {
      expect(screen.getByText('Copy Link')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Copy Link'))

    await waitFor(() => {
      expect(analyticsMocks.trackBrandPageShared).toHaveBeenCalledWith(
        'test-brand',
        'brand-id-123',
        'copy_link',
      )
    })
  })
})
