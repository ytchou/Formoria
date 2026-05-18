// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { ReviewStep } from './ReviewStep'

function Wrapper({ children }: { children: React.ReactNode }) {
  const methods = useForm({
    defaultValues: {
      name: '雨靴工作室',
      description: 'Handcrafted rain boots from Tainan.',
      category: 'fashion',
      tags: ['handmade'],
      logoUrl: 'https://example.com/logo.webp',
      productPhotos: ['https://example.com/p1.webp'],
      productHighlights: 'Cedar wood soles.',
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
  return <FormProvider {...methods}>{children}</FormProvider>
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

  it('displays product photos count', () => {
    render(
      <Wrapper>
        <ReviewStep onEditStep={vi.fn()} />
      </Wrapper>
    )
    expect(screen.getByText(/1 photo/i)).toBeInTheDocument()
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
    expect(screen.getByText(/privacy policy/i)).toHaveAttribute(
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
    const editButtons = screen.getAllByText(/edit/i)
    await user.click(editButtons[0])
    expect(onEditStep).toHaveBeenCalledWith(0)
  })
})
