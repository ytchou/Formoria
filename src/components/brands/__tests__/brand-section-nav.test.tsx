// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import zh from '../../../../messages/zh-TW.json'
import { shouldShowBrandSectionNav } from '@/lib/brands/section-nav'
import { BrandSectionNav } from '../brand-section-nav'

const sections = [
  { id: 'about', label: '品牌介紹' },
  { id: 'social', label: '社群平台' },
  { id: 'purchase', label: '購買資訊' },
]

function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('BrandSectionNav', () => {
  beforeEach(() => {
    class IntersectionObserverMock {
      observe = vi.fn()
      disconnect = vi.fn()
    }

    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)
  })

  it('renders all section labels as anchor links', () => {
    renderWithIntl(<BrandSectionNav sections={sections} />)

    for (const section of sections) {
      expect(screen.getByRole('link', { name: section.label })).toHaveAttribute(
        'href',
        `#${section.id}`,
      )
    }
  })



  it('does not add a redundant back-to-top control', () => {
    renderWithIntl(<BrandSectionNav sections={sections} />)

    expect(screen.queryByRole('button', { name: '置頂' })).not.toBeInTheDocument()
  })

  it('does not render when fewer than two sections are provided', () => {
    expect(shouldShowBrandSectionNav(1)).toBe(false)
    expect(shouldShowBrandSectionNav(2)).toBe(true)

    const { container, rerender } = renderWithIntl(
      <BrandSectionNav sections={[]} />,
    )
    expect(container).toBeEmptyDOMElement()

    rerender(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <BrandSectionNav sections={[sections[0]]} />
      </NextIntlClientProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
