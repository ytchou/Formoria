// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BrandSectionNav } from '../brand-section-nav'

class IntersectionObserverStub {
  observe() {}
  disconnect() {}
}

const messages = { brandDetail: { tabNav: { overview: 'Overview' } } }

function renderNav(ariaLabel?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <div id="overview">Overview section</div>
      <div id="products">Products section</div>
      <BrandSectionNav
        sections={[
          { id: 'overview', label: 'Overview' },
          { id: 'products', label: 'Products' },
        ]}
        ariaLabel={ariaLabel}
      />
    </NextIntlClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

describe('BrandSectionNav', () => {
  it('accepts a custom ariaLabel', () => {
    renderNav('Curated theme sections')

    expect(screen.getByRole('navigation', { name: 'Curated theme sections' })).toBeInTheDocument()
  })

  it('skips smooth scrolling under prefers-reduced-motion', () => {
    renderNav()
    const target = document.getElementById('products') as HTMLElement
    const scrollIntoView = vi.spyOn(target, 'scrollIntoView')

    fireEvent.click(screen.getByRole('link', { name: 'Products' }))

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto' })
  })
})
