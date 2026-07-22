// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { useState } from 'react'
import { FormProvider, useForm, useWatch } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '@/../messages/en.json'
import { BrandLocationsSection } from '@/components/brand-wizard/locations-section'
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
  const [showLocations, setShowLocations] = useState(true)

  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {showLocations ? (
        <LocationsSection form={form} isActualOwner={isActualOwner} />
      ) : null}
      <output data-testid="location-values">
        {JSON.stringify(watchedLocations ?? [])}
      </output>
      <button
        type="button"
        onClick={() => setShowLocations((visible) => !visible)}
      >
        Toggle locations step
      </button>
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

function SubmissionSurfaceWrapper({
  retailLocations,
}: Pick<WrapperProps, 'retailLocations'>) {
  const form = useForm<BrandEditFormValues>({
    defaultValues: { retailLocations },
  })
  const watchedLocations = useWatch({
    control: form.control,
    name: 'retailLocations',
  })

  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <FormProvider {...form}>
        <BrandLocationsSection
          isActualOwner={false}
          preserveOwnerConfirmation={false}
        />
      </FormProvider>
      <output data-testid="location-values">
        {JSON.stringify(watchedLocations ?? [])}
      </output>
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
    expect(
      screen.getByRole('status', { name: 'Not confirmed by the brand owner' }),
    ).toHaveAttribute(
      'data-confirmation-status',
      'unconfirmed',
    )
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
        name: 'I confirm this is a current physical location where this brand\'s products can be purchased',
      }),
    ).toBeChecked()
    expect(
      screen.getByRole('status', { name: 'Confirmed by the brand owner' }),
    ).toHaveAttribute(
      'data-confirmation-status',
      'owner_confirmed',
    )
  })

  it('does not expose owner confirmation to non-owners', () => {
    render(<Wrapper retailLocations={[CONFIRMED_LOCATION]} />)

    expect(
      screen.queryByRole('checkbox', {
        name: 'I confirm this is a current physical location where this brand\'s products can be purchased',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('status', { name: 'Confirmed by the brand owner' }),
    ).toHaveAttribute(
      'data-confirmation-status',
      'owner_confirmed',
    )
  })

  it('requires an address before owner confirmation', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper
        isActualOwner
        retailLocations={[
          {
            ...CONFIRMED_LOCATION,
            address: '   ',
            confirmationStatus: 'unconfirmed',
          },
        ]}
      />,
    )

    await user.click(
      screen.getByRole('checkbox', {
        name: 'I confirm this is a current physical location where this brand\'s products can be purchased',
      }),
    )

    expect(
      screen.getByText('Add an address before confirming this location.'),
    ).toBeVisible()
    expect(
      screen.getByRole('checkbox', {
        name: 'I confirm this is a current physical location where this brand\'s products can be purchased',
      }),
    ).not.toBeChecked()
    expect(readLocationValues()[0]).toMatchObject({
      confirmationStatus: 'unconfirmed',
    })
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
        name: 'I confirm this is a current physical location where this brand\'s products can be purchased',
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
    await user.click(await screen.findByRole('option', { name: 'Stockist' }))

    expect(
      screen.getByRole('checkbox', {
        name: 'I confirm this is a current physical location where this brand\'s products can be purchased',
      }),
    ).not.toBeChecked()
  })

  it('preserves confirmation when the availability note changes', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper
        isActualOwner
        retailLocations={[CONFIRMED_LOCATION]}
      />,
    )
    const confirmation = screen.getByRole('checkbox', {
        name: 'I confirm this is a current physical location where this brand\'s products can be purchased',
    })

    await user.type(screen.getByLabelText('Note'), ' Selected products only.')

    expect(confirmation).toBeChecked()
    expect(readLocationValues()[0]).toMatchObject({
      availabilityNote: 'Call ahead. Selected products only.',
      confirmationStatus: 'owner_confirmed',
    })
  })

  it('resets confirmation when coordinates change', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper
        isActualOwner
        retailLocations={[CONFIRMED_LOCATION]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Update map metadata' }))

    await waitFor(() => {
      expect(
        screen.getByRole('checkbox', {
        name: 'I confirm this is a current physical location where this brand\'s products can be purchased',
        }),
      ).not.toBeChecked()
      expect(readLocationValues()[0]).toMatchObject({
        confirmationStatus: 'unconfirmed',
      })
    })
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
    await user.click(
      await screen.findByRole('option', { name: 'Retail chain' }),
    )

    expect(screen.getByLabelText('Retail chain name')).toBeInTheDocument()
    expect(
      screen.getByLabelText('Official or store-locator URL'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Address')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', {
        name: 'I confirm this is a current physical location where this brand\'s products can be purchased',
      }),
    ).not.toBeInTheDocument()
    expect(readLocationValues()[0]).toEqual({
      kind: 'retail_chain',
      name: 'Warmwood Xinyi',
      retailerUrl: '',
      availabilityNote: 'Call ahead.',
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
    await user.click(
      await screen.findByRole('option', { name: 'Physical location' }),
    )

    expect(screen.getByLabelText('Address')).toBeInTheDocument()
    expect(readLocationValues()[0]).toMatchObject({
      kind: 'location',
      name: 'Lifestyle Mart',
      relationshipType: 'stockist',
      availabilityNote: 'Selected stores only.',
      confirmationStatus: 'unconfirmed',
    })
    expect(readLocationValues()[0]).not.toHaveProperty('retailerUrl')
  })

  it('scrubs retained physical data from a retail-chain draft', async () => {
    render(
      <Wrapper
        retailLocations={[
          {
            ...CONFIRMED_LOCATION,
            kind: 'retail_chain',
            retailerUrl: 'https://retailer.example/stores',
          },
        ]}
      />,
    )

    expect(screen.getByLabelText('Retail chain name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Address')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(readLocationValues()).toEqual([
        {
          kind: 'retail_chain',
          name: 'Warmwood Xinyi',
          retailerUrl: 'https://retailer.example/stores',
          availabilityNote: 'Call ahead.',
        },
      ])
    })
  })

  it('keeps a location draft when the wizard step remounts', async () => {
    const user = userEvent.setup()
    render(<Wrapper retailLocations={[CONFIRMED_LOCATION]} />)

    await user.clear(screen.getByLabelText('Note'))
    await user.type(screen.getByLabelText('Note'), 'Weekend stock only.')
    await user.click(
      screen.getByRole('button', { name: 'Toggle locations step' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Toggle locations step' }),
    )

    expect(screen.getByLabelText('Note')).toHaveValue('Weekend stock only.')
    expect(readLocationValues()[0]).toMatchObject({
      availabilityNote: 'Weekend stock only.',
    })
  })

  it('strips owner confirmation from the submission surface', async () => {
    render(
      <SubmissionSurfaceWrapper retailLocations={[CONFIRMED_LOCATION]} />,
    )

    expect(
      screen.queryByRole('checkbox', {
        name: 'I confirm this is a current physical location where this brand\'s products can be purchased',
      }),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(
      screen.getByRole('status', { name: 'Not confirmed by the brand owner' }),
      ).toHaveAttribute(
        'data-confirmation-status',
        'unconfirmed',
      )
      expect(readLocationValues()[0]).toMatchObject({
        confirmationStatus: 'unconfirmed',
      })
    })
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
