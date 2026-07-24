// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QuickActions } from '../quick-actions'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(
    (namespace: string) =>
      (key: string) => {
        const messages: Record<string, string> = {
          'dashboard.overview.quickActionsTitle': '管理重點',
          'dashboard.overview.quickActions.editProfile.description':
            '更新品牌基本資料與描述',
          'dashboard.overview.quickActions.checkHealth.description':
            '檢視品牌完整度與狀態',
          'dashboard.overview.quickActions.viewAnalytics.description':
            '掌握品牌表現與趨勢',
          'dashboard.overview.quickActions.readFaq.description':
            '尋找使用說明與解答',
          'dashboard.welcome.tips.editProfile': '編輯品牌資料',
          'dashboard.welcome.tips.checkHealth': '檢查品牌健康度',
          'dashboard.welcome.tips.viewAnalytics': '查看分析數據',
          'dashboard.welcome.tips.readFaq': '閱讀品牌主常見問題',
        }

        return messages[`${namespace}.${key}`] ?? key
      },
  ),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: ComponentProps<'a'>) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe('QuickActions', () => {
  it('renders_4_action_cards_with_correct_hrefs', async () => {
    render(await QuickActions({ brandSlug: 'test-brand' }))

    const expectedHrefs = [
      '/dashboard/brands/test-brand/edit',
      '#profile-completeness',
      '/dashboard/brands/test-brand/analytics',
      '/faq#for-owners',
    ]

    expect(screen.getAllByRole('link')).toHaveLength(4)
    screen.getAllByRole('link').forEach((link, index) => {
      expect(link).toHaveAttribute('href', expectedHrefs[index])
    })
  })

  it('renders_section_heading', async () => {
    render(await QuickActions({ brandSlug: 'test-brand' }))

    expect(
      screen.getByRole('heading', { name: '管理重點' }),
    ).toBeInTheDocument()
  })

  it('each_card_has_icon_title_description_chevron', async () => {
    render(await QuickActions({ brandSlug: 'test-brand' }))

    const expectedCards = [
      ['編輯品牌資料', '更新品牌基本資料與描述', 'pencil'],
      ['檢查品牌健康度', '檢視品牌完整度與狀態', 'heart-pulse'],
      ['查看分析數據', '掌握品牌表現與趨勢', 'chart-no-axes-column'],
      ['閱讀品牌主常見問題', '尋找使用說明與解答', 'book-open'],
    ] as const

    screen.getAllByRole('link').forEach((card, index) => {
      const [title, description] = expectedCards[index]
      const cardQueries = within(card)

      expect(cardQueries.getByRole('heading', { name: title })).toBeInTheDocument()
      expect(cardQueries.getByText(description)).toBeInTheDocument()
      expect(card.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2)
    })
  })
})
