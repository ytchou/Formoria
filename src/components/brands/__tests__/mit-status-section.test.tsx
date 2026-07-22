// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Brand } from '@/lib/types'
import { MitStatusSection } from '../mit-status-section'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string, params?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      mitDeclared: '品牌聲明',
      mitDeclaredTitle: '由品牌方自行聲明台灣製造',
      mitVerified: 'MIT 認證',
      mitVerifiedTitle: '已通過 MIT 認證',
      'mitStatus.scope.all': '全部產品',
      'mitStatus.scope.most': '大部分產品',
      'mitStatus.scope.some': '部分產品',
      'mitStatus.registrySource': '資料來源：MIT Smile 台灣製產品名錄',
      'mitStatus.reportOrigin': '回報產地資訊',
    }

    if (key === 'mitStatus.declaredOn') return `聲明日期：${params?.date}`
    if (key === 'mitProofLink') return `MIT 微笑標章證號 ${params?.cert}`
    return messages[key] ?? key
  }),
}))

function makeBrand(overrides: Partial<Brand>): Brand {
  return {
    id: 'brand-1',
    name: '測試品牌',
    slug: 'test-brand',
    mitStatus: 'unverified',
    ...overrides,
  } as Brand
}

describe('MitStatusSection', () => {
  it('shows declaration scope and date for declared brands', async () => {
    render(
      await MitStatusSection({
        brand: makeBrand({
          mitStatus: 'declared',
          mitDeclaredScope: 'most',
          mitDeclaredAt: '2026-05-12T00:00:00.000Z',
        }),
        locale: 'zh-TW',
      }),
    )

    expect(screen.getByText('品牌聲明')).toBeInTheDocument()
    expect(screen.getByText('大部分產品')).toBeInTheDocument()
    expect(screen.getByText('聲明日期：2026年5月12日')).toBeInTheDocument()
  })

  it('renders only the evidence entry for unverified brands', async () => {
    render(
      await MitStatusSection({
        brand: makeBrand({ mitStatus: 'unverified' }),
        locale: 'zh-TW',
      }),
    )

    expect(screen.queryByText('品牌聲明')).not.toBeInTheDocument()
    expect(screen.queryByText('MIT 認證')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '回報產地資訊' })).toBeInTheDocument()
  })
})
