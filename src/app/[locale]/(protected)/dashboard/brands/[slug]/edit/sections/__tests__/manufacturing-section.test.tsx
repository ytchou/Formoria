// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import messages from '@/../messages/en.json'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { ManufacturingSection } from '../manufacturing-section'

function Wrapper() {
  const form = useForm<BrandEditFormValues>()
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <ManufacturingSection form={form} />
    </NextIntlClientProvider>
  )
}

describe('ManufacturingSection', () => {
  it('renders a manufacturing-related field', () => {
    render(<Wrapper />)
    const els = screen.queryAllByText(/manufactur|factory|production/i)
    expect(els.length).toBeGreaterThan(0)
  })
})
