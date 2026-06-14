// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { NextIntlClientProvider } from 'next-intl'
import zhMessages from '../../../messages/zh-TW.json'
import { ReviewStep } from './ReviewStep'

vi.mock('./TurnstileWidget', () => ({
  TurnstileWidget: () => null,
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const methods = useForm({
    defaultValues: {
      name: '雨靴工作室',
      description: 'Handcrafted rain boots from Tainan.',
      category: 'fashion',
      tags: ['handmade'],
      logoUrl: 'https://example.com/logo.webp',
      productPhotos: ['https://example.com/p1.webp'],
      brandHighlights: 'Cedar wood soles.',
      purchaseLinks: [
        { platform: 'shopee', url: 'https://shopee.tw/store' },
      ],
      socialLinks: {
        instagram: '@mybrand',
        threads: '',
        facebook: '',
        website: 'https://mybrand.com',
      },
      retailLocations: [] as { name: string; address: string }[],
      pdpaConsent: false,
    },
  })
  return (
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      <FormProvider {...methods}>{children}</FormProvider>
    </NextIntlClientProvider>
  )
}

describe('ReviewStep', () => {
  it('displays brand info in review panel', () => {
    render(
      <Wrapper>
        <ReviewStep onEditStep={vi.fn()} />
      </Wrapper>
    )
    expect(screen.getByText('雨靴工作室')).toBeInTheDocument()
    expect(
      screen.getByText(/handcrafted rain boots/i)
    ).toBeInTheDocument()
  })

  it('displays purchase links', () => {
    render(
      <Wrapper>
        <ReviewStep onEditStep={vi.fn()} />
      </Wrapper>
    )
    expect(screen.getAllByText(/shopee/i).length).toBeGreaterThanOrEqual(1)
  })

  it('renders PDPA consent checkbox unchecked by default', () => {
    render(
      <Wrapper>
        <ReviewStep onEditStep={vi.fn()} />
      </Wrapper>
    )
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).not.toBeChecked()
  })

  it('links to privacy policy', () => {
    render(
      <Wrapper>
        <ReviewStep onEditStep={vi.fn()} />
      </Wrapper>
    )
    // pdpaConsent rich text renders "隱私政策" as a link in zh-TW
    expect(screen.getByText(/隱私政策/)).toHaveAttribute(
      'href',
      '/privacy'
    )
  })

  it('calls onEditStep when Edit button is clicked', async () => {
    const user = userEvent.setup()
    const onEditStep = vi.fn()
    render(
      <Wrapper>
        <ReviewStep onEditStep={onEditStep} />
      </Wrapper>
    )
    // edit = "編輯" in zh-TW
    const editButtons = screen.getAllByText(/編輯/)
    await user.click(editButtons[0])
    expect(onEditStep).toHaveBeenCalledWith(0)
  })
})
