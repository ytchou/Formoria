import { describe, expect, it } from 'vitest'
import type { PhysicalRetailLocation, RetailLocation } from '@/lib/types/brand'
import {
  getDuplicateRetailLocationIndex,
  getLocationMapQuery,
  hasValidRetailLocationCoordinates,
  isConfirmedRetailLocation,
  isMappableRetailLocation,
  isPublicMappableRetailLocation,
  isPublicRetailLocation,
  isPhysicalRetailLocation,
  isRetailChainChannel,
  isUnconfirmedRetailLocation,
  normalizeRetailLocations,
  reconcileRetailLocationConfirmation,
  reconcileRetailLocationConfirmations,
} from './locations'

function physical(
  overrides: Partial<PhysicalRetailLocation> = {},
): PhysicalRetailLocation {
  return {
    kind: 'location',
    name: 'Flagship',
    relationshipType: 'brand_store',
    confirmationStatus: 'unconfirmed',
    ...overrides,
  }
}

describe('normalizeRetailLocations', () => {
  it('normalizes legacy physical rows without emitting legacy type', () => {
    expect(
      normalizeRetailLocations([
        {
          name: ' Taipei Stockist ',
          address: ' Taipei City ',
          type: 'independent',
        },
      ]),
    ).toEqual([
      {
        kind: 'location',
        name: 'Taipei Stockist',
        relationshipType: 'stockist',
        address: 'Taipei City',
        city: undefined,
        district: undefined,
        venueName: undefined,
        floorOrCounter: undefined,
        availabilityNote: undefined,
        latitude: undefined,
        longitude: undefined,
        verificationStatus: 'manual',
        confirmationStatus: 'unconfirmed',
      },
    ])
  })

  it('uses explicit canonical kind before legacy classification hints', () => {
    const locations = normalizeRetailLocations([
      {
        kind: 'retail_chain',
        name: 'Chain',
        type: 'independent',
        address: 'Must be dropped',
        retailerUrl: ' https://retailer.example/shops ',
        confirmationStatus: 'owner_confirmed',
      },
      {
        kind: 'location',
        name: 'Specific branch',
        type: 'chain',
        address: 'No. 1',
        confirmationStatus: 'owner_confirmed',
      },
    ])

    expect(locations).toEqual([
      {
        kind: 'retail_chain',
        name: 'Chain',
        retailerUrl: 'https://retailer.example/shops',
        availabilityNote: undefined,
      },
      expect.objectContaining({
        kind: 'location',
        name: 'Specific branch',
        address: 'No. 1',
        confirmationStatus: 'owner_confirmed',
      }),
    ])
    expect(locations.at(0)).not.toHaveProperty('address')
    expect(locations.at(0)).not.toHaveProperty('type')
  })

  it('classifies legacy chain rows without geography as channels', () => {
    expect(
      normalizeRetailLocations([
        { name: '康是美', type: 'chain', availabilityNote: '部分門市' },
      ]),
    ).toEqual([
      {
        kind: 'retail_chain',
        name: '康是美',
        retailerUrl: undefined,
        availabilityNote: '部分門市',
      },
    ])
  })

  it('treats address, valid coordinates, and other legacy leads as physical', () => {
    const locations = normalizeRetailLocations([
      { name: 'Chain branch', type: 'chain', address: 'No. 1' },
      { name: 'Coordinate lead', type: 'chain', latitude: 25, longitude: 121 },
      { venueName: 'Venue-only lead' },
    ])

    expect(locations).toHaveLength(3)
    expect(locations.every(isPhysicalRetailLocation)).toBe(true)
    expect(locations.map((location) => location.name)).toEqual([
      'Chain branch',
      'Coordinate lead',
      'Venue-only lead',
    ])
    expect(locations.map((location) => location.confirmationStatus)).toEqual([
      'unconfirmed',
      'unconfirmed',
      'unconfirmed',
    ])
  })

  it('preserves only trimmed HTTP(S) retailer URLs', () => {
    const locations = normalizeRetailLocations([
      { kind: 'retail_chain', name: 'Valid', retailerUrl: ' https://example.com/find ' },
      { kind: 'retail_chain', name: 'Invalid', retailerUrl: 'javascript:alert(1)' },
      { kind: 'retail_chain', name: 'FTP', retailerUrl: 'ftp://example.com' },
    ])

    expect(locations.map((location) => location.retailerUrl)).toEqual([
      'https://example.com/find',
      undefined,
      undefined,
    ])
  })

  it('keeps coordinate verification independent from owner confirmation', () => {
    const [location] = normalizeRetailLocations([
      {
        kind: 'location',
        name: 'Pinned lead',
        relationshipType: 'stockist',
        latitude: '25.033',
        longitude: '121.565',
        verificationStatus: 'verified',
        confirmationStatus: 'unconfirmed',
      },
    ])

    expect(location).toMatchObject({
      verificationStatus: 'verified',
      confirmationStatus: 'unconfirmed',
    })
    expect(location && hasValidRetailLocationCoordinates(location)).toBe(true)
    expect(location && hasValidRetailLocationCoordinates(location)).toBe(true)
    expect(location && isMappableRetailLocation(location)).toBe(false)
  })

  it('publishes and maps addressed legacy locations without inferring owner confirmation', () => {
    const [location] = normalizeRetailLocations([
      {
        name: 'Legacy coordinate lead',
        address: 'No. 1',
        latitude: 25.033,
        longitude: 121.565,
        confirmationStatus: 'unconfirmed',
      },
    ])

    expect(location).toMatchObject({ verificationStatus: 'manual' })
    expect(location && isPublicRetailLocation(location)).toBe(true)
    expect(location && isPublicMappableRetailLocation(location)).toBe(true)
  })

  it('drops incomplete, out-of-range coordinate pairs and empty rows', () => {
    const locations = normalizeRetailLocations([
      { name: 'Incomplete', latitude: 25 },
      { name: 'Out of range', latitude: 250, longitude: 121 },
      { name: '', address: '', venueName: '' },
    ])

    expect(locations).toHaveLength(2)
    expect(locations.every((location) => !hasValidRetailLocationCoordinates(location))).toBe(true)
  })

  it('provides kind guards and physical-only map queries', () => {
    const [location, channel] = normalizeRetailLocations([
      { kind: 'location', name: 'Shop', relationshipType: 'stockist', venueName: 'Mall', address: 'No. 1' },
      { kind: 'retail_chain', name: 'Chain' },
    ])

    expect(location && isPhysicalRetailLocation(location)).toBe(true)
    expect(channel && isRetailChainChannel(channel)).toBe(true)
    expect(location && getLocationMapQuery(location)).toBe('Shop Mall No. 1')
    expect(channel && getLocationMapQuery(channel)).toBe('Chain')
  })
})

describe('getDuplicateRetailLocationIndex', () => {
  it('detects physical duplicates by normalized address or coordinates', () => {
    expect(
      getDuplicateRetailLocationIndex([
        physical({ address: 'Taipei 101' }),
        physical({ address: ' Taipei   101 ' }),
      ]),
    ).toBe(1)
    expect(
      getDuplicateRetailLocationIndex([
        physical({ name: 'A', latitude: 25.033964, longitude: 121.564468 }),
        physical({ name: 'B', latitude: 25.0339641, longitude: 121.5644681 }),
      ]),
    ).toBe(1)
  })

  it('detects chain duplicates by normalized name or URL', () => {
    expect(
      getDuplicateRetailLocationIndex([
        { kind: 'retail_chain', name: 'Retail Chain' },
        { kind: 'retail_chain', name: ' retail   chain ' },
      ]),
    ).toBe(1)
    expect(
      getDuplicateRetailLocationIndex([
        { kind: 'retail_chain', name: 'A', retailerUrl: 'https://example.com/find' },
        { kind: 'retail_chain', name: 'B', retailerUrl: ' https://example.com/find ' },
      ]),
    ).toBe(1)
  })

  it('allows cross-kind identity overlap', () => {
    expect(
      getDuplicateRetailLocationIndex([
        physical({ name: 'Retail Chain', address: 'No. 1' }),
        { kind: 'retail_chain', name: 'Retail Chain', retailerUrl: 'https://example.com' },
      ]),
    ).toBeUndefined()
  })
})

describe('retail location eligibility', () => {
  const confirmed = physical({
    address: 'No. 1',
    latitude: 25.033,
    longitude: 121.565,
    confirmationStatus: 'owner_confirmed',
  })

  it('requires owner confirmation and a non-empty address for confirmed lists', () => {
    expect(isConfirmedRetailLocation(confirmed)).toBe(true)
    expect(
      isConfirmedRetailLocation(
        physical({
          address: '   ',
          confirmationStatus: 'owner_confirmed',
        }),
      ),
    ).toBe(false)
    expect(
      isConfirmedRetailLocation(
        physical({ address: 'No. 1', confirmationStatus: 'unconfirmed' }),
      ),
    ).toBe(false)
  })

  it('maps only confirmed locations with valid coordinates', () => {
    expect(isMappableRetailLocation(confirmed)).toBe(true)
    expect(
      isMappableRetailLocation(
        physical({ latitude: 25.033, longitude: 121.565 }),
      ),
    ).toBe(false)
    expect(
      isMappableRetailLocation(
        physical({
          address: 'No. 1',
          confirmationStatus: 'owner_confirmed',
        }),
      ),
    ).toBe(false)
  })

  it('classifies every remaining physical row as unconfirmed', () => {
    expect(isUnconfirmedRetailLocation(confirmed)).toBe(false)
    expect(isUnconfirmedRetailLocation(physical())).toBe(true)
    expect(
      isUnconfirmedRetailLocation({ kind: 'retail_chain', name: 'Chain' }),
    ).toBe(false)
  })
})

describe('retail location confirmation reconciliation', () => {
  const confirmed = physical({
    address: 'No. 1',
    venueName: 'Mall',
    floorOrCounter: '2F',
    confirmationStatus: 'owner_confirmed',
  })

  it('allows only owners to newly confirm addressed physical locations', () => {
    expect(
      reconcileRetailLocationConfirmation({
        next: { ...confirmed },
        isActualOwner: true,
      }),
    ).toMatchObject({ confirmationStatus: 'owner_confirmed' })
    expect(
      reconcileRetailLocationConfirmation({
        next: { ...confirmed, address: undefined },
        isActualOwner: true,
      }),
    ).toMatchObject({ confirmationStatus: 'unconfirmed' })
    expect(
      reconcileRetailLocationConfirmation({
        next: { ...confirmed },
        isActualOwner: false,
      }),
    ).toMatchObject({ confirmationStatus: 'unconfirmed' })
  })

  it('preserves non-owner confirmation only when every identity field matches', () => {
    const next = { ...confirmed, confirmationStatus: 'unconfirmed' as const }
    expect(
      reconcileRetailLocationConfirmation({ previous: confirmed, next, isActualOwner: false }),
    ).toMatchObject({ confirmationStatus: 'owner_confirmed' })
    expect(
      reconcileRetailLocationConfirmation({
        previous: confirmed,
        next: { ...next, floorOrCounter: '3F' },
        isActualOwner: false,
      }),
    ).toMatchObject({ confirmationStatus: 'unconfirmed' })
    expect(
      reconcileRetailLocationConfirmation({
        previous: { ...confirmed, latitude: 25.033, longitude: 121.565 },
        next: { ...next, latitude: 25.034, longitude: 121.565 },
        isActualOwner: false,
      }),
    ).toMatchObject({ confirmationStatus: 'unconfirmed' })
    expect(
      reconcileRetailLocationConfirmation({
        previous: confirmed,
        next: { ...next, availabilityNote: 'Weekends only' },
        isActualOwner: false,
      }),
    ).toMatchObject({ confirmationStatus: 'owner_confirmed' })
  })

  it('does not preserve invalid owner confirmation without an address', () => {
    const invalidConfirmed = physical({
      confirmationStatus: 'owner_confirmed',
    })

    expect(
      reconcileRetailLocationConfirmation({
        previous: invalidConfirmed,
        next: { ...invalidConfirmed, confirmationStatus: 'unconfirmed' },
        isActualOwner: false,
      }),
    ).toMatchObject({ confirmationStatus: 'unconfirmed' })
  })

  it('never gives channels confirmation state', () => {
    const channel: RetailLocation = {
      kind: 'retail_chain',
      name: 'Chain',
      retailerUrl: 'https://example.com',
    }
    expect(
      reconcileRetailLocationConfirmation({ next: channel, isActualOwner: true }),
    ).toEqual(channel)
    expect(
      reconcileRetailLocationConfirmation({ next: channel, isActualOwner: true }),
    ).not.toHaveProperty('confirmationStatus')
  })

  it('matches prior identities rather than indexes when rows reorder', () => {
    const second = physical({ name: 'Second', address: 'No. 2' })
    const reconciled = reconcileRetailLocationConfirmations({
      previous: [confirmed, second],
      next: [second, { ...confirmed, confirmationStatus: 'unconfirmed' }],
      isActualOwner: false,
    })

    expect(reconciled.map((location) => location.name)).toEqual(['Second', 'Flagship'])
    expect(reconciled.at(1)).toMatchObject({ confirmationStatus: 'owner_confirmed' })
  })
})
