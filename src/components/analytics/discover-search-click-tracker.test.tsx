/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

const trackProductSearchResultClicked = vi.fn()
vi.mock('@/lib/analytics', () => ({
  trackProductSearchResultClicked: (...args: unknown[]) =>
    trackProductSearchResultClicked(...args),
}))

import { DiscoverSearchClickTracker } from './discover-search-click-tracker'

describe('DiscoverSearchClickTracker', () => {
  beforeEach(() => {
    trackProductSearchResultClicked.mockClear()
  })

  it('fires product_search_result_clicked on card click', () => {
    const { container } = render(
      <DiscoverSearchClickTracker searchId="sid-1" query="陶瓷杯">
        <ul>
          <li data-brand-slug="warmwood" data-product-key="linen-mug">
            <span>Product</span>
          </li>
        </ul>
      </DiscoverSearchClickTracker>,
    )

    fireEvent.click(container.querySelector('span')!)

    expect(trackProductSearchResultClicked).toHaveBeenCalledExactlyOnceWith({
      searchId: 'sid-1',
      position: 0,
      productKey: 'linen-mug',
      brandSlug: 'warmwood',
      query: '陶瓷杯',
    })
  })

  it('extracts product info from data attributes', () => {
    const { container } = render(
      <DiscoverSearchClickTracker searchId="sid-2" query="test">
        <ul>
          <li data-brand-slug="brand-abc" data-product-key="key-xyz">
            <button type="button">Click me</button>
          </li>
        </ul>
      </DiscoverSearchClickTracker>,
    )

    fireEvent.click(container.querySelector('button')!)

    expect(trackProductSearchResultClicked).toHaveBeenCalledWith(
      expect.objectContaining({
        brandSlug: 'brand-abc',
        productKey: 'key-xyz',
      }),
    )
  })

  it('computes position from sibling index', () => {
    const { container } = render(
      <DiscoverSearchClickTracker searchId="sid-3" query="test">
        <ul>
          <li data-brand-slug="a" data-product-key="p0">
            <span>0</span>
          </li>
          <li data-brand-slug="b" data-product-key="p1">
            <span>1</span>
          </li>
          <li data-brand-slug="c" data-product-key="p2">
            <span>2</span>
          </li>
        </ul>
      </DiscoverSearchClickTracker>,
    )

    // Click the second item
    fireEvent.click(container.querySelectorAll('li')[1]!)

    expect(trackProductSearchResultClicked).toHaveBeenCalledWith(
      expect.objectContaining({ position: 1 }),
    )
  })

  it('ignores clicks outside product cards', () => {
    const { container } = render(
      <DiscoverSearchClickTracker searchId="sid-4" query="test">
        <div data-testid="wrapper">
          <ul>
            <li data-brand-slug="a" data-product-key="p0">
              <span>Product</span>
            </li>
          </ul>
        </div>
      </DiscoverSearchClickTracker>,
    )

    // Click the wrapper div, not a product card
    fireEvent.click(container.querySelector('[data-testid="wrapper"]')!)

    expect(trackProductSearchResultClicked).not.toHaveBeenCalled()
  })

  it('SaveButton stopPropagation prevents tracking', () => {
    const { container } = render(
      <DiscoverSearchClickTracker searchId="sid-5" query="test">
        <ul>
          <li data-brand-slug="a" data-product-key="p0">
            <button
              type="button"
              data-testid="save"
              onClick={(e) => e.stopPropagation()}
            >
              Save
            </button>
          </li>
        </ul>
      </DiscoverSearchClickTracker>,
    )

    fireEvent.click(container.querySelector('[data-testid="save"]')!)

    expect(trackProductSearchResultClicked).not.toHaveBeenCalled()
  })
})
