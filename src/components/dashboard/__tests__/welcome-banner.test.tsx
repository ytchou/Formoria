// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { DimensionKey } from '@/lib/services/brand-health'

const mockTrackShown = vi.fn()
const mockTrackCta = vi.fn()
const mockTrackDismiss = vi.fn()

vi.mock('@/lib/analytics', () => ({
  trackOnboardingBannerShown: (...args: unknown[]) => mockTrackShown(...args),
  trackOnboardingBannerCtaClick: (...args: unknown[]) => mockTrackCta(...args),
  trackOnboardingBannerDismiss: (...args: unknown[]) => mockTrackDismiss(...args),
}))

import { WelcomeBanner } from '../welcome-banner'

const messages = {
  dashboard: {
    onboarding: {
      banner: {
        title: '歡迎加入 Formoria！',
        description: '讓我們一起讓你的品牌被更多人看見。',
        action1: '上傳品牌封面照',
        action1Hint: '訪客第一眼看到的視覺印象',
        action2: '撰寫品牌介紹',
        action2Hint: '幫助消費者認識你的品牌故事',
        action3: '新增購買連結',
        action3Hint: '讓有興趣的人直接下單',
        topPick: '首選',
        cta: '開始編輯',
        dismiss: '稍後再說',
      },
    },
    health: {
      actionQueue: {
        label: {
          photoQuality: 'Add more product photos',
        },
      },
    },
  },
}

function renderBanner(
  props?: Partial<{
    claimedAt: string
    completionFraction: number
    slug: string
    topAction: { labelKey: DimensionKey; anchor: string; points: number }
  }>
) {
  const now = new Date()
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <WelcomeBanner
        claimedAt={props?.claimedAt ?? threeDaysAgo}
        completionFraction={props?.completionFraction ?? 0.33}
        slug={props?.slug ?? 'test-brand'}
        topAction={props?.topAction}
      />
    </NextIntlClientProvider>
  )
}

describe('WelcomeBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders banner with welcome title and 3 actions', () => {
    renderBanner()
    expect(screen.getByText('歡迎加入 Formoria！')).toBeInTheDocument()
    expect(screen.getByText('上傳品牌封面照')).toBeInTheDocument()
    expect(screen.getByText('撰寫品牌介紹')).toBeInTheDocument()
    expect(screen.getByText('新增購買連結')).toBeInTheDocument()
  })

  it('renders CTA link pointing to edit page media section', () => {
    renderBanner({ slug: 'my-brand' })
    const cta = screen.getByRole('link', { name: /開始編輯/ })
    expect(cta).toHaveAttribute('href', '/dashboard/brands/my-brand/edit#media')
  })

  it('shows the top health nudge as a quick win', () => {
    renderBanner({
      slug: 'my-brand',
      topAction: {
        labelKey: 'photoQuality',
        anchor: '#product-photos',
        points: 1200,
      },
    })

    expect(screen.getByText('首選')).toBeInTheDocument()
    const nudge = screen.getByRole('link', { name: /Add more product photos/ })
    expect(nudge).toHaveAttribute(
      'href',
      '/dashboard/brands/my-brand/edit#product-photos'
    )
    expect(screen.getByText('上傳品牌封面照')).toBeInTheDocument()
    expect(screen.getByText('撰寫品牌介紹')).toBeInTheDocument()
    expect(screen.getByText('新增購買連結')).toBeInTheDocument()
  })

  it('hides banner when dismiss is clicked', () => {
    renderBanner()
    const dismiss = screen.getByRole('button', { name: /稍後再說/ })
    fireEvent.click(dismiss)
    expect(screen.queryByText('歡迎加入 Formoria！')).not.toBeInTheDocument()
  })

  it('fires GA4 dismiss event on dismiss click', () => {
    renderBanner({ slug: 'test-brand' })
    fireEvent.click(screen.getByRole('button', { name: /稍後再說/ }))
    expect(mockTrackDismiss).toHaveBeenCalledWith('test-brand')
  })

  it('does not render when claimedAt is older than 7 days', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    renderBanner({ claimedAt: eightDaysAgo })
    expect(screen.queryByText('歡迎加入 Formoria！')).not.toBeInTheDocument()
  })

  it('does not render when completionFraction is 1 (100%)', () => {
    renderBanner({ completionFraction: 1 })
    expect(screen.queryByText('歡迎加入 Formoria！')).not.toBeInTheDocument()
  })

  it('does not render when claimedAt is null', () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={messages}>
        <WelcomeBanner claimedAt={null} completionFraction={0.33} slug="test-brand" />
      </NextIntlClientProvider>
    )
    expect(screen.queryByText('歡迎加入 Formoria！')).not.toBeInTheDocument()
  })
})
