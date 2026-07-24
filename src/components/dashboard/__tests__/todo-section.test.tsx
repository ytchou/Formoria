// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProfileCompleteness } from '@/lib/services/profile-completeness'
import { TodoSection } from '../todo-section'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(
    (namespace: string) =>
      (key: string, params?: Record<string, unknown>) => {
        const messages: Record<string, string> = {
          'dashboard.overview.todoTitle': '待辦事項',
          'dashboard.overview.todoEmpty': '所有項目已完成！',
          'dashboard.overview.todoGoComplete': '前往完成',
          'dashboard.overview.todoDescription.description':
            '撰寫品牌故事以吸引更多消費者',
          'dashboard.overview.todoDescription.productPhotos':
            '新增品牌圖片與產品圖片',
          'dashboard.profileCompleteness.component.description': '新增品牌故事',
          'dashboard.profileCompleteness.component.productPhotos': '上傳產品照片',
        }

        if (`${namespace}.${key}` === 'dashboard.overview.todoRemaining') {
          return `剩 ${params?.count} 項`
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

const incomplete: ProfileCompleteness = {
  score: 80,
  completed: 9,
  total: 11,
  components: [],
  recommendations: [
    {
      key: 'description',
      complete: false,
      required: true,
      weight: 5,
      step: 0,
    },
    {
      key: 'productPhotos',
      complete: false,
      required: true,
      weight: 5,
      step: 1,
    },
  ],
}

describe('TodoSection', () => {
  it('renders_incomplete_recommendations_as_actionable_rows', async () => {
    render(
      await TodoSection({
        completeness: incomplete,
        slug: 'test-brand',
        mitStatus: 'verified',
      }),
    )

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('新增品牌故事')).toBeInTheDocument()
    expect(
      within(rows[0]).getByText('撰寫品牌故事以吸引更多消費者'),
    ).toBeInTheDocument()
    expect(
      within(rows[0]).getByRole('link', { name: '前往完成' }),
    ).toBeInTheDocument()
    expect(within(rows[1]).getByText('上傳產品照片')).toBeInTheDocument()
    expect(
      within(rows[1]).getByText('新增品牌圖片與產品圖片'),
    ).toBeInTheDocument()
    expect(
      within(rows[1]).getByRole('link', { name: '前往完成' }),
    ).toBeInTheDocument()
  })

  it('renders_remaining_count_badge', async () => {
    render(
      await TodoSection({
        completeness: incomplete,
        slug: 'test-brand',
        mitStatus: 'verified',
      }),
    )

    expect(screen.getAllByText('剩 1 項')).toHaveLength(2)
  })

  it('renders_empty_state_when_all_complete', async () => {
    render(
      await TodoSection({
        completeness: {
          ...incomplete,
          score: 100,
          completed: 11,
          recommendations: [],
        },
        slug: 'test-brand',
        mitStatus: 'verified',
      }),
    )

    expect(screen.getByText('所有項目已完成！')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('action_links_point_to_correct_edit_steps', async () => {
    render(
      await TodoSection({
        completeness: incomplete,
        slug: 'test-brand',
        mitStatus: 'verified',
      }),
    )

    const links = screen.getAllByRole('link', { name: '前往完成' })
    expect(links[0]).toHaveAttribute(
      'href',
      '/dashboard/brands/test-brand/edit?step=0',
    )
    expect(links[1]).toHaveAttribute(
      'href',
      '/dashboard/brands/test-brand/edit?step=1',
    )
  })
})
