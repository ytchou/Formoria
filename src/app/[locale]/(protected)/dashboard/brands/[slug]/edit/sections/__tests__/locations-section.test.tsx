// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { useForm, useWatch } from 'react-hook-form'
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

const CONFIRMED_LOCATION = {
  kind: 'location' as const,
  name: 'Warmwood Xinyi',
  relationshipType: 'brand_store' as const,
  address: 'No. 1 Xinyi Road, Taipei',
  venueName: 'Warmwood Flagship',
  floorOrCounter: '3F',
  availabilityNote: 'Call ahead.',
  latitude: 25.033,
  longitude: 121.5654,
  verificationStatus: 'verified' as const,
  confirmationStatus: 'owner_confirmed' as const,
}

type WrapperProps = {
  isActualOwner?: boolean
  retailLocations?: BrandEditFormValues['retailLocations']
}

function Wrapper({
  isActualOwner = false,
  retailLocations = [],
}: WrapperProps) {
  const form = useForm<BrandEditFormValues>({
    defaultValues: { retailLocations },
  })
  const watchedLocations = useWatch({
    control: form.control,
    name: 'retailLocations',
  })

  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <LocationsSection form={form} isActualOwner={isActualOwner} />
      <output data-testid="location-values">
        {JSON.stringify(watchedLocations ?? [])}
      </output>
      <button
        type="button"
        onClick={() => {
          form.setValue('retailLocations.0.latitude', 24.991, {
            shouldDirty: true,
          })
          form.setValue('retailLocations.0.longitude', 121.301, {
            shouldDirty: true,
          })
          form.setValue('retailLocations.0.verificationStatus', 'verified', {
            shouldDirty: true,
          })
        }}
      >
        Update map metadata
      </button>
    </NextIntlClientProvider>
  )
}

function readLocationValues() {
  return JSON.parse(screen.getByTestId('location-values').textContent ?? '[]')
}

describe('LocationsSection', () => {
  it('adds a canonical physical-location editor', async () => {
    const user = userEvent.setup()
    render(<Wrapper />)

    await user.click(
      screen.getByRole('button', { name: 'Add location or retail chain' }),
    )

    expect(screen.getByLabelText('Information type')).toBeInTheDocument()
    expect(screen.getByLabelText('Location name')).toBeInTheDocument()
    expect(screen.getByLabelText('Location type')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Search or enter the full address'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Search address' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Venue name')).toBeInTheDocument()
    expect(screen.getByLabelText('Floor or counter')).toBeInTheDocument()
    expect(screen.getByLabelText('Note')).toBeInTheDocument()
    expect(readLocationValues()[0]).toMatchObject({
      kind: 'location',
      name: '',
      relationshipType: 'stockist',
      confirmationStatus: 'unconfirmed',
    })
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

  it('shows owner confirmation only to an actual owner', async () => {
    render(
      <Wrapper
        isActualOwner
        retailLocations={[CONFIRMED_LOCATION]}
      />,
    )

    expect(
      screen.getByRole('checkbox', {
        name: 'I confirm this physical location is current',
      }),
    ).toBeChecked()
  })

  it('does not expose owner confirmation to non-owners', () => {
    render(<Wrapper retailLocations={[CONFIRMED_LOCATION]} />)

    expect(
      screen.queryByRole('checkbox', {
        name: 'I confirm this physical location is current',
      }),
    ).not.toBeInTheDocument()
  })

  it.each([
    ['Location name', 'Warmwood Renai'],
    ['Address', 'No. 2 Renai Road, Taipei'],
    ['Venue name', 'Warmwood Renai Flagship'],
    ['Floor or counter', '4F'],
  ])('resets owner confirmation when %s changes', async (label, value) => {
    const user = userEvent.setup()
    render(
      <Wrapper
        isActualOwner
        retailLocations={[CONFIRMED_LOCATION]}
      />,
    )
    await user.clear(screen.getByLabelText(label))
    await user.type(screen.getByLabelText(label), value)

    expect(
      screen.getByRole('checkbox', {
        name: 'I confirm this physical location is current',
      }),
    ).not.toBeChecked()
    expect(readLocationValues()[0]).toMatchObject({
      confirmationStatus: 'unconfirmed',
    })
  })

  it('resets confirmation when the relationship changes', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper
        isActualOwner
        retailLocations={[CONFIRMED_LOCATION]}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Location type' }))
    await user.click(screen.getByRole('option', { name: 'Stockist' }))

    expect(
      screen.getByRole('checkbox', {
        name: 'I confirm this physical location is current',
      }),
    ).not.toBeChecked()
  })

  it('preserves confirmation for note and map metadata changes', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper
        isActualOwner
        retailLocations={[CONFIRMED_LOCATION]}
      />,
    )
    const confirmation = screen.getByRole('checkbox', {
      name: 'I confirm this physical location is current',
    })

    await user.type(screen.getByLabelText('Note'), ' Selected products only.')
    await user.click(screen.getByRole('button', { name: 'Update map metadata' }))

    expect(confirmation).toBeChecked()
  })

  it('scrubs incompatible fields when switching information kind', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper
        isActualOwner
        retailLocations={[CONFIRMED_LOCATION]}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Information type' }))
    await user.click(screen.getByRole('option', { name: 'Retail chain' }))

    expect(screen.getByLabelText('Retail chain name')).toBeInTheDocument()
    expect(screen.getByLabelText('Official or store-locator URL')).toBeInTheDocument()
    expect(screen.queryByLabelText('Address')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', {
        name: 'I confirm this physical location is current',
      }),
    ).not.toBeInTheDocument()
    expect(readLocationValues()[0]).toEqual({
      kind: 'retail_chain',
      name: '',
      retailerUrl: '',
      availabilityNote: '',
    })

  })

  it('scrubs chain fields when switching to a physical location', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper
        isActualOwner
        retailLocations={[
          {
            kind: 'retail_chain',
            name: 'Lifestyle Mart',
            retailerUrl: 'https://retailer.example/stores',
            availabilityNote: 'Selected stores only.',
          },
        ]}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Information type' }))
    await user.click(screen.getByRole('option', { name: 'Physical location' }))

    expect(screen.getByLabelText('Address')).toBeInTheDocument()
    expect(readLocationValues()[0]).toMatchObject({
      kind: 'location',
      name: '',
      relationshipType: 'stockist',
      confirmationStatus: 'unconfirmed',
    })
    expect(readLocationValues()[0]).not.toHaveProperty('retailerUrl')
  })

  it('shows explicit feedback when address search has no results', async () => {
    const user = userEvent.setup()
    render(<Wrapper />)

    await user.click(
      screen.getByRole('button', { name: 'Add location or retail chain' }),
    )
    await user.type(
      screen.getByPlaceholderText('Search or enter the full address'),
      'No matching address',
    )
    await user.click(screen.getByRole('button', { name: 'Search address' }))

    expect(await screen.findByText(/No matching location found/)).toBeVisible()
  })

})
