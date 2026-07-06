// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import messages from '@/../messages/en.json'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { PoliciesSection } from '../policies-section'

function Wrapper() {
  const form = useForm<BrandEditFormValues>()
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <PoliciesSection form={form} />
    </NextIntlClientProvider>
  )
}

describe('PoliciesSection', () => {
  it('renders returns policy textarea', () => {
    render(<Wrapper />)
    const el = screen.queryByLabelText(/returns/i) || screen.queryByText(/returns/i)
    expect(el).toBeInTheDocument()
  })
})
