// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import messages from '@/../messages/en.json'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { BasicInfoSection } from '../basic-info-section'

function Wrapper({
  defaultValues = {},
}: {
  defaultValues?: Partial<BrandEditFormValues>
}) {
  const form = useForm<BrandEditFormValues>({ defaultValues })
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <BasicInfoSection form={form} />
    </NextIntlClientProvider>
  )
}

describe('BasicInfoSection', () => {
  it('renders name field', () => {
    render(<Wrapper />)
    expect(screen.getByLabelText(/brand name/i)).toBeInTheDocument()
  })

  it('renders product type field', () => {
    render(<Wrapper />)
    const label =
      screen.queryByLabelText(/category/i) ||
      screen.queryByLabelText(/product type/i) ||
      screen.queryByText(/category/i)
    expect(label).toBeInTheDocument()
  })

  it('pre-fills name with defaultValues', () => {
    render(<Wrapper defaultValues={{ name: 'Warmwood Living' }} />)
    expect(screen.getByDisplayValue('Warmwood Living')).toBeInTheDocument()
  })

  it('shows meaningful labels for selected taxonomy values', () => {
    render(
      <Wrapper
        defaultValues={{
          productType: 'beauty',
          city: 'taipei',
          priceRange: 2,
        }}
      />
    )

    expect(screen.getByText('美妝保養 (Beauty & Personal Care)')).toBeInTheDocument()
    expect(screen.getByText('Taipei City')).toBeInTheDocument()
    expect(screen.getByText('$$ · Mid-range (NT$1,000–5,000)')).toBeInTheDocument()
  })

  it('places product-tag guidance before the tag input', () => {
    render(<Wrapper />)

    const guidance = screen.getByText('Up to 5 tags. Describe products, not promotional claims.')
    const input = screen.getByRole('combobox', { name: 'Product tags' })
    expect(guidance.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(input).toHaveAttribute('placeholder', 'Add product tag')
  })
})
