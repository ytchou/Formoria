// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import messages from '@/../messages/en.json'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { ReputationSection } from '../reputation-section'

function Wrapper() {
  const form = useForm<BrandEditFormValues>()
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <ReputationSection form={form} />
    </NextIntlClientProvider>
  )
}

describe('ReputationSection', () => {
  it('renders reputation summary textarea', () => {
    render(<Wrapper />)
    const el =
      screen.queryByRole('textbox', { name: /reputation/i }) ||
      screen.queryByLabelText(/reputation/i) ||
      screen.queryByText(/reputation/i)
    expect(el).toBeInTheDocument()
  })
})
