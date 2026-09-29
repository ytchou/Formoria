import { describe, expect, it } from 'vitest'

import {
  normalizeCandidates,
  resolveArbitratedName,
} from '../../enrich-phases/names'
import { buildNameArbiterUserContent, type NameCandidate } from '../../name-arbiter'
import { shippedName, shippedNameSweep, type ShippedSweepPoint } from '../names-shipped'

/** A single-item user message rendered by the production formatter. */
function userFor(slug: string, storedName: string, candidates: NameCandidate[]): string {
  return buildNameArbiterUserContent([
    { slug, storedName, candidates: normalizeCandidates(storedName, candidates) },
  ])
}

const renameUser = userFor('adela-shop', 'ADELA shop', [
  { source: 'cleaned', value: 'ADELA' },
  { source: 'detected', value: 'Adela Atelier' },
])

describe('shippedName', () => {
  it('returns the stored name for a stored pick at any band', () => {
    for (const confidence of ['high', 'medium', 'low'] as const) {
      expect(shippedName(renameUser, { chosen: 'ADELA shop', confidence })).toBe('ADELA shop')
    }
  })

  it('falls back when a low-band pick renames', () => {
    const candidates = normalizeCandidates('ADELA shop', [
      { source: 'cleaned', value: 'ADELA' },
      { source: 'detected', value: 'Adela Atelier' },
    ])
    const expected = resolveArbitratedName(
      { chosen: 'Adela Atelier', confidence: 'low', reason: '' },
      candidates,
      'ADELA shop',
    )
    expect(expected).toBe('ADELA')
    expect(shippedName(renameUser, { chosen: 'Adela Atelier', confidence: 'low' })).toBe(expected)
    // Control: the same rename ships at high.
    expect(shippedName(renameUser, { chosen: 'Adela Atelier', confidence: 'high' })).toBe('Adela Atelier')
  })

  it('rejects a bilingual addition without official evidence even at high', () => {
    const detectedOnly = userFor('adela', 'Adela', [{ source: 'detected', value: '愛德拉 Adela' }])
    expect(shippedName(detectedOnly, { chosen: '愛德拉 Adela', confidence: 'high' })).toBe('Adela')

    // Control: first-party evidence lets the same addition through.
    const official = userFor('adela', 'Adela', [
      {
        source: 'official_website',
        value: '愛德拉 Adela',
        evidence: [
          { source: 'official_website', url: 'https://adela.example.com', observedName: '愛德拉 Adela' },
        ],
      },
    ])
    expect(shippedName(official, { chosen: '愛德拉 Adela', confidence: 'high' })).toBe('愛德拉 Adela')
  })

  it('treats a null pick as no verdict and ships the fallback', () => {
    expect(shippedName(renameUser, { chosen: null, confidence: 'low' })).toBe('ADELA')
  })

  it('returns null when the user message does not hold exactly one item line', () => {
    expect(shippedName('no item here', { chosen: 'x', confidence: 'high' })).toBeNull()
    const twoItems = buildNameArbiterUserContent([
      { slug: 'a', storedName: 'A', candidates: [{ source: 'cleaned', value: 'A' }] },
      { slug: 'b', storedName: 'B', candidates: [{ source: 'cleaned', value: 'B' }] },
    ])
    expect(shippedName(twoItems, { chosen: 'A', confidence: 'high' })).toBeNull()
  })
})

describe('shippedNameSweep', () => {
  const stripUser = userFor('bloom-studio', 'Bloom Studio', [{ source: 'detected', value: 'Bloom' }])
  const points: ShippedSweepPoint[] = [
    // A correct rename at 0.8: ships only when high <= 0.8.
    { user: renameUser, chosen: 'Adela Atelier', probability: 0.8, acceptedNames: ['Adela Atelier'] },
    // A wrong rename at 0.6: must fall back, so high > 0.6.
    { user: renameUser, chosen: 'Adela Atelier', probability: 0.6, acceptedNames: ['ADELA'] },
    // A correct strip at 0.55: ships at medium, so medium <= 0.55.
    { user: stripUser, chosen: 'Bloom', probability: 0.55, acceptedNames: ['Bloom'] },
    // A stored pick always ships the stored name.
    { user: stripUser, chosen: 'Bloom Studio', probability: 0.3, acceptedNames: ['Bloom Studio'] },
  ]

  it('picks the max-agreement cutoffs, ties to the higher cutoff', () => {
    const { rows, best, skipped } = shippedNameSweep(points)
    expect(skipped).toBe(0)

    // high in 0.65..0.80 and medium in 0.50..0.55 all reach 4/4; the tie goes
    // to the highest high cutoff, then the highest medium cutoff.
    expect(best).toEqual({ high: 0.8, medium: 0.55, agreement: 1 })

    expect(rows.every((row) => row.medium < row.high)).toBe(true)
    expect(rows).toHaveLength(45)
    expect(rows.find((row) => row.high === 0.95 && row.medium === 0.9)?.agreement).toBe(0.5)
  })

  it('skips and counts points whose user does not parse', () => {
    const bad: ShippedSweepPoint = { user: 'no item here', chosen: 'x', probability: 0.9, acceptedNames: ['x'] }
    const { rows, best, skipped } = shippedNameSweep([...points, bad, bad])

    expect(skipped).toBe(2)
    expect(best).toEqual({ high: 0.8, medium: 0.55, agreement: 1 })
    expect(rows.every((row) => row.total === points.length)).toBe(true)
  })

  it('throws when no point parses', () => {
    const bad: ShippedSweepPoint = { user: 'no item here', chosen: 'x', probability: 0.9, acceptedNames: ['x'] }
    expect(() => shippedNameSweep([bad])).toThrow(/parseable point/)
  })
})
