import { describe, expect, it } from 'vitest'
import {
  getDuplicateRetailLocationIndex,
  hasLocationCoordinates,
  normalizeRetailLocations,
} from './locations'

describe('normalizeRetailLocations', () => {
  it('keeps legacy name/address records usable', () => {
    expect(
      normalizeRetailLocations([
        { name: 'Taipei Stockist', address: 'Taipei City' },
      ]),
    ).toEqual([
      {
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
      },
    ])
  })

  it('marks entries with coordinates as pinnable', () => {
    const locations = normalizeRetailLocations([
      {
        name: 'Flagship',
        address: 'No. 1',
        latitude: '25.033',
        longitude: '121.565',
      },
    ])

    const location = locations.at(0)
    expect(location).toBeDefined()
    expect(location && hasLocationCoordinates(location)).toBe(true)
    expect(location?.verificationStatus).toBe('verified')
  })

  it('drops empty rows', () => {
    expect(normalizeRetailLocations([{ name: '', address: '' }])).toEqual([])
  })

  it('does not coerce blank coordinates into a verified map pin', () => {
    const locations = normalizeRetailLocations([
      {
        name: 'Manual Stockist',
        address: 'Taipei City',
        latitude: '',
        longitude: '',
      },
    ])

    expect(locations.at(0)).toMatchObject({
      latitude: undefined,
      longitude: undefined,
      verificationStatus: 'manual',
    })
    expect(locations.at(0) && hasLocationCoordinates(locations.at(0)!)).toBe(
      false,
    )
  })

  it('drops out-of-range coordinates', () => {
    const locations = normalizeRetailLocations([
      {
        name: 'Bad Pin',
        address: 'Taipei City',
        latitude: '250',
        longitude: '121.565',
      },
    ])

    expect(locations.at(0)?.latitude).toBeUndefined()
    expect(locations.at(0)?.longitude).toBeUndefined()
    expect(locations.at(0)?.verificationStatus).toBe('manual')
  })
})

describe('getDuplicateRetailLocationIndex', () => {
  it('flags repeated normalized addresses', () => {
    expect(
      getDuplicateRetailLocationIndex([
        { address: 'Taipei 101' },
        { address: ' Taipei   101 ' },
      ]),
    ).toBe(1)
  })

  it('flags repeated verified coordinates', () => {
    expect(
      getDuplicateRetailLocationIndex([
        { address: 'A', latitude: 25.033964, longitude: 121.564468 },
        { address: 'B', latitude: '25.0339641', longitude: '121.5644681' },
      ]),
    ).toBe(1)
  })

  it('allows distinct manual locations', () => {
    expect(
      getDuplicateRetailLocationIndex([
        { address: 'Taipei 101' },
        { address: 'Songshan Cultural Park' },
      ]),
    ).toBeUndefined()
  })
})
