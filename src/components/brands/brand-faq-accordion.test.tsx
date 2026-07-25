// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'

const mocks = vi.hoisted(() => ({
  trackFaqItemExpanded: vi.fn(),
}))

vi.mock('@/lib/analytics', () => ({
  trackFaqItemExpanded: mocks.trackFaqItemExpanded,
}))

import { BrandFaqAccordion } from './brand-faq-accordion'

const messages = {
  brandDetail: {
    sections: {
      faq: 'FAQ',
    },
  },
}

const faqItems = [
  { question: '這個品牌在哪裡購買？', answer: '可在官網購買。' },
  { question: '有提供退貨服務嗎？', answer: '有，七天內可退貨。' },
]

function renderFaq(brandSlug = 'test-brand') {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={messages}>
      <BrandFaqAccordion items={faqItems} brandSlug={brandSlug} />
    </NextIntlClientProvider>,
  )
}

describe('BrandFaqAccordion', () => {
  it('uses the shared section heading hierarchy', () => {
    renderFaq()

    expect(screen.getByRole('heading', { name: 'FAQ' })).toHaveClass(
      'type-section-title-large',
    )
    expect(
      screen.getByRole('button', { name: '這個品牌在哪裡購買？' }),
    ).toHaveClass('type-faq-question')
  })

  it('fires trackFaqItemExpanded with brand slug and index when an accordion item is opened', async () => {
    const user = userEvent.setup()
    renderFaq('my-brand')

    await user.click(screen.getByText('這個品牌在哪裡購買？'))

    expect(mocks.trackFaqItemExpanded).toHaveBeenCalledTimes(1)
    expect(mocks.trackFaqItemExpanded).toHaveBeenCalledWith('my-brand', 0)
  })

  it('does not fire trackFaqItemExpanded when an open item is closed', async () => {
    const user = userEvent.setup()
    renderFaq('my-brand')

    await user.click(screen.getByText('這個品牌在哪裡購買？'))
    mocks.trackFaqItemExpanded.mockClear()
    await user.click(screen.getByText('這個品牌在哪裡購買？'))

    expect(mocks.trackFaqItemExpanded).not.toHaveBeenCalled()
  })
})
