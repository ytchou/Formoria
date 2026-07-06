// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import messages from '@/../messages/en.json'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { LocationsSection } from '../locations-section'

function Wrapper() {
  const form = useForm<BrandEditFormValues>()
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <LocationsSection form={form} />
    </NextIntlClientProvider>
  )
}

describe('LocationsSection', () => {
  it('renders add location button', () => {
    render(<Wrapper />)
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument()
  })
})
