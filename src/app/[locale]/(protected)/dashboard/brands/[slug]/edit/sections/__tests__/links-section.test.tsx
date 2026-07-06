// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import messages from '@/../messages/en.json'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { LinksSection } from '../links-section'

function Wrapper() {
  const form = useForm<BrandEditFormValues>()
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <LinksSection form={form} />
    </NextIntlClientProvider>
  )
}

describe('LinksSection', () => {
  it('renders at least one social link field', () => {
    render(<Wrapper />)
    const field = screen.queryByLabelText(/instagram/i) || screen.queryByText(/instagram/i)
    expect(field).toBeInTheDocument()
  })

  it('renders add link button for dynamic URLs', () => {
    render(<Wrapper />)
    const btn = screen.queryByRole('button', { name: /add/i })
    expect(btn).toBeInTheDocument()
  })
})
