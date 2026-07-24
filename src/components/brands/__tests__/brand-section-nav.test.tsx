// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import zh from '../../../../messages/zh-TW.json'
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

  it('highlights the first section by default', () => {
    renderWithIntl(<BrandSectionNav sections={sections} />)

    expect(screen.getByRole('link', { name: sections[0].label })).toHaveClass(
      'type-nav-item-active',
      'border-b-2',
      'border-primary',
    )
  })

  it('renders the back-to-top button', () => {
    renderWithIntl(<BrandSectionNav sections={sections} />)

    expect(screen.getByRole('button', { name: '置頂' })).toBeInTheDocument()
  })

  it('does not render when fewer than two sections are provided', () => {
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
