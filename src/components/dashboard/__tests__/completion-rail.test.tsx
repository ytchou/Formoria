// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProfileCompleteness } from '@/lib/services/profile-completeness'
import { CompletionRail } from '../completion-rail'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(() => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key),
  getLocale: vi.fn(() => 'zh-TW'),
}))

vi.mock('@/lib/services/brands', () => ({ getBrandBySlug: vi.fn() }))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: ComponentProps<'a'>) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

const incomplete: ProfileCompleteness = {
  score: 75,
  completed: 9,
  total: 12,
  components: [],
  recommendations: [
    {
      key: 'description',
      complete: false,
      required: true,
      weight: 5,
      step: 0,
    },
  ],
}

describe('CompletionRail', () => {
  it('completion rail renders progress bar and warning', async () => {
    render(
      await CompletionRail({
        completeness: incomplete,
        slug: 'test-brand',
        mitStatus: 'declared',
      }),
    )

    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75')
    expect(screen.getByText('warningIncomplete:{"count":1}')).toBeInTheDocument()
  })

  it('completion rail hides warning when complete', async () => {
    render(
      await CompletionRail({
        completeness: {
          ...incomplete,
          score: 100,
          completed: 12,
          recommendations: [],
        },
        slug: 'test-brand',
        mitStatus: 'verified',
      }),
    )

    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.queryByText(/warningIncomplete/)).not.toBeInTheDocument()
  })
})
