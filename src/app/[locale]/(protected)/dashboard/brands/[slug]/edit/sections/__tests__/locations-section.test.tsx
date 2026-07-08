// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'
import messages from '@/../messages/en.json'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { LocationsSection } from '../locations-section'

vi.mock('@/lib/actions/location-search', () => ({
  searchLocationAction: vi.fn().mockResolvedValue({ success: true, results: [] }),
}))

function Wrapper() {
  const form = useForm<BrandEditFormValues>()
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <LocationsSection form={form} />
    </NextIntlClientProvider>
  )
}

describe('LocationsSection', () => {
  it('adds a compact stockist location editor', async () => {
    const user = userEvent.setup()
    render(<Wrapper />)

    await user.click(screen.getByRole('button', { name: /add/i }))

    expect(screen.getByLabelText('Location type')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Search or enter the full address'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Search address' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Floor or counter')).toBeInTheDocument()
    expect(screen.getByLabelText('Availability note')).toBeInTheDocument()
    expect(screen.queryByLabelText('Map status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Latitude')).not.toBeInTheDocument()
  })
})
