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
})
