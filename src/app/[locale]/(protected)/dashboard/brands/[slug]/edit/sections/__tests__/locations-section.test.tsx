// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { useForm } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '@/../messages/en.json'
import { searchLocationAction } from '@/lib/actions/location-search'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { LocationsSection } from '../locations-section'

vi.mock('@/lib/actions/location-search', () => ({
  searchLocationAction: vi.fn().mockResolvedValue({ success: true, results: [] }),
}))

const mockSearchLocationAction = vi.mocked(searchLocationAction)

beforeEach(() => {
  mockSearchLocationAction.mockClear()
})

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

    await user.click(
      screen.getByRole('button', { name: 'Add retail location' }),
    )

    expect(screen.getByLabelText('Location type')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Search or enter the full address'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Search address' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Floor or counter')).toBeInTheDocument()
    expect(screen.getByLabelText('Note')).toBeInTheDocument()
    expect(screen.getByText(/Add brand-owned shops/)).toBeVisible()
    expect(screen.queryByLabelText('Map status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Latitude')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/If the place is not listed/),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Explain location/)).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText(/Explain floor or counter/),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows explicit feedback when address search has no results', async () => {
    const user = userEvent.setup()
    render(<Wrapper />)

    await user.click(
      screen.getByRole('button', { name: 'Add retail location' }),
    )
    await user.type(
      screen.getByPlaceholderText('Search or enter the full address'),
      'No matching address',
    )
    await user.click(screen.getByRole('button', { name: 'Search address' }))

    expect(await screen.findByText(/No matching location found/)).toBeVisible()
  })

})
