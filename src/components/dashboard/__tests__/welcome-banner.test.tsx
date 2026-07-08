// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '@/../messages/en.json'
import zhTW from '@/../messages/zh-TW.json'
import { WelcomeBanner } from '../welcome-banner'

vi.mock(
  '@/app/[locale]/(protected)/dashboard/brands/[slug]/walkthrough-actions',
  () => ({
    visitDashboardWalkthroughStep: vi.fn(),
  }),
)

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: React.ComponentProps<'a'>) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

describe('WelcomeBanner', () => {
  it('shows persisted progress and the next step', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WelcomeBanner
          brandId="brand-id"
          completedCount={1}
          nextStep="media_links"
          slug="test-brand"
          steps={[
            { key: 'brand_basics', status: 'complete' },
            { key: 'media_links', status: 'not_started' },
            { key: 'analytics', status: 'not_started' },
            { key: 'health', status: 'not_started' },
            { key: 'verification', status: 'not_started' },
          ]}
        />
      </NextIntlClientProvider>,
    )

    expect(screen.getByText('1 of 5 visited')).toBeInTheDocument()
    expect(screen.getByText('Add media & links')).toBeInTheDocument()
    expect(screen.getByText('Check your analytics')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '1',
    )

    expect(
      screen.getByRole('button', { name: /Add media & links/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Check your analytics/ }),
    ).toBeInTheDocument()
  })

  it('renders at 100% when all steps are completed', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WelcomeBanner
          brandId="brand-id"
          completedCount={5}
          nextStep={null}
          slug="test-brand"
          steps={[
            { key: 'brand_basics', status: 'complete' },
            { key: 'media_links', status: 'complete' },
            { key: 'analytics', status: 'complete' },
            { key: 'health', status: 'complete' },
            { key: 'verification', status: 'complete' },
          ]}
        />
      </NextIntlClientProvider>,
    )

    expect(screen.getByText('5 of 5 visited')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '5',
    )
  })

  it('resolves every onboarding message in Traditional Chinese', () => {
    const onError = vi.fn()

    render(
      <NextIntlClientProvider locale="zh-TW" messages={zhTW} onError={onError}>
        <WelcomeBanner
          brandId="brand-id"
          completedCount={0}
          nextStep="brand_basics"
          slug="test-brand"
          steps={[
            { key: 'brand_basics', status: 'not_started' },
            { key: 'media_links', status: 'not_started' },
            { key: 'analytics', status: 'not_started' },
            { key: 'health', status: 'not_started' },
            { key: 'verification', status: 'not_started' },
          ]}
        />
      </NextIntlClientProvider>,
    )

    expect(screen.getByText('查看品牌資料')).toBeInTheDocument()
    expect(screen.getByText('新增媒體與連結')).toBeInTheDocument()
    expect(screen.getByText('查看數據分析')).toBeInTheDocument()
    expect(screen.getByText('檢視品牌檔案完成度')).toBeInTheDocument()
    expect(screen.getByText('了解品牌驗證')).toBeInTheDocument()
    expect(onError).not.toHaveBeenCalled()
  })
})
