import { describe, it, expect } from 'vitest'
import {
  ENRICH_PHASES,
  IMAGE_ENRICH_PHASES,
  TEXT_ENRICH_PHASES,
} from '../enrich-phases'

describe('scoped enrich phase sets', () => {
  it('only contains phases that exist in ENRICH_PHASES', () => {
    // parseEnrichPhases drops unknown phase names and then falls back to ALL
    // phases when the result is empty, so a typo would silently run everything.
    const all = ENRICH_PHASES as readonly string[]
    for (const phase of IMAGE_ENRICH_PHASES) expect(all).toContain(phase)
    for (const phase of TEXT_ENRICH_PHASES) expect(all).toContain(phase)
  })

  it('keeps the image and text sets disjoint', () => {
    const image = new Set<string>(IMAGE_ENRICH_PHASES)
    expect(TEXT_ENRICH_PHASES.some((phase) => image.has(phase))).toBe(false)
  })

  it('covers every phase across both sets', () => {
    expect(
      [...IMAGE_ENRICH_PHASES, ...TEXT_ENRICH_PHASES].sort(),
    ).toEqual([...ENRICH_PHASES].sort())
  })

  it('routes discover into the text set and not the image set', () => {
    expect(TEXT_ENRICH_PHASES).toContain('discover')
    expect(TEXT_ENRICH_PHASES).not.toContain('images')
    expect(TEXT_ENRICH_PHASES).not.toContain('classify_images')
  })
})
