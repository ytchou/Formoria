import { describe, expect, it } from 'vitest'

import {
  isFullyResolvable,
  isPrivateStorageKey,
  planImageResolvability,
  type ResolvabilityRow,
} from '@/lib/images/image-resolvability'

const BRAND_ID = '11111111-2222-3333-4444-555555555555'
const SUBMISSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const PUBLIC_KEY = `brands/${BRAND_ID}/a.webp`
const PRIVATE_KEY = `submissions/${SUBMISSION_ID}/a.webp`

function row(overrides: Partial<ResolvabilityRow> = {}): ResolvabilityRow {
  return { id: 'row-1', storagePath: PUBLIC_KEY, ...overrides }
}

describe('planImageResolvability', () => {
  it('accepts a public key whose object exists', () => {
    const report = planImageResolvability([row()], new Set([PUBLIC_KEY]))

    expect(report).toMatchObject({
      scanned: 1,
      resolvable: 1,
      withoutStoragePath: 0,
    })
    expect(report.unresolvable).toEqual([])
    expect(isFullyResolvable(report)).toBe(true)
  })

  // The staging outage: rows copied without their bytes. Every existing unit
  // test of the URL builder stayed green while the page rendered blank.
  it('reports a public key with no object as missing', () => {
    const report = planImageResolvability([row()], new Set())

    expect(report.counts['missing-object']).toBe(1)
    expect(report.unresolvable).toEqual([
      { id: 'row-1', storagePath: PUBLIC_KEY, reason: 'missing-object' },
    ])
    expect(isFullyResolvable(report)).toBe(false)
  })

  // The latent production defect: the bytes are there and the proxy still
  // refuses them, so "the object exists" must not clear the row.
  it('reports a deny-listed key even when the object exists', () => {
    const report = planImageResolvability(
      [row({ storagePath: PRIVATE_KEY })],
      new Set([PRIVATE_KEY]),
    )

    expect(report.counts).toEqual({
      'missing-object': 0,
      'private-prefix': 1,
    })
    expect(report.unresolvable.at(0)?.reason).toBe('private-prefix')
  })

  it('counts a row with no key separately instead of failing it', () => {
    const report = planImageResolvability(
      [row({ storagePath: null }), row({ id: 'row-2', storagePath: '  ' })],
      new Set(),
    )

    expect(report.withoutStoragePath).toBe(2)
    expect(report.unresolvable).toEqual([])
    expect(isFullyResolvable(report)).toBe(true)
  })

  it('trims a padded key before looking it up', () => {
    const report = planImageResolvability(
      [row({ storagePath: ` ${PUBLIC_KEY} ` })],
      new Set([PUBLIC_KEY]),
    )

    expect(report.resolvable).toBe(1)
  })

  it('tallies a mixed set', () => {
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b', storagePath: `brands/${BRAND_ID}/missing.webp` }),
      row({ id: 'c', storagePath: PRIVATE_KEY }),
      row({ id: 'd', storagePath: null }),
    ]

    const report = planImageResolvability(rows, new Set([PUBLIC_KEY]))

    expect(report).toMatchObject({
      scanned: 4,
      resolvable: 1,
      withoutStoragePath: 1,
    })
    expect(report.counts).toEqual({
      'missing-object': 1,
      'private-prefix': 1,
    })
  })
})

describe('isPrivateStorageKey', () => {
  it('follows the proxy deny-list rather than a second copy of it', () => {
    expect(isPrivateStorageKey(PRIVATE_KEY)).toBe(true)
    expect(isPrivateStorageKey(PUBLIC_KEY)).toBe(false)
    expect(isPrivateStorageKey('curated-products/x.webp')).toBe(false)
    expect(isPrivateStorageKey('events/x.webp')).toBe(false)
  })
})
