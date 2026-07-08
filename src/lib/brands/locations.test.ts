import { describe, expect, it } from 'vitest'
import {
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
