import { describe, it, expect } from 'vitest'
import {
  CURATION_STEPS,
  CURATION_STEP_ORDER,
  ENRICH_LLM_PHASES,
  ENRICH_PHASES,
  ENRICH_STAGE_GROUPS,
  IMAGE_ENRICH_PHASES,
  LOCAL_PHASES,
  SERP_PHASES,
  TEXT_ENRICH_PHASES,
  phasesForSteps,
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

describe('curation steps', () => {
  const steps = Object.entries(CURATION_STEPS) as [string, readonly string[]][]

  it('assigns every ENRICH_PHASES member to a step', () => {
    const assigned = new Set<string>(steps.flatMap(([, phases]) => phases))
    const unassigned = (ENRICH_PHASES as readonly string[]).filter(
      (phase) => !assigned.has(phase),
    )
    expect(
      unassigned,
      `phases with no step assignment: ${unassigned.join(', ') || '(none)'} — add each to CURATION_STEPS.context, .image or .detail`,
    ).toEqual([])
  })

  it('assigns no phase outside ENRICH_PHASES', () => {
    const all = new Set<string>(ENRICH_PHASES)
    for (const [name, phases] of steps) {
      const unknown = phases.filter((phase) => !all.has(phase))
      expect(unknown, `${name} contains unknown phases: ${unknown.join(', ')}`).toEqual([])
    }
  })

  it('assigns each phase to exactly one step', () => {
    const seen = new Map<string, string>()
    const duplicates: string[] = []
    for (const [name, phases] of steps) {
      for (const phase of phases) {
        const owner = seen.get(phase)
        if (owner) {
          duplicates.push(`${phase} (in ${owner} and ${name})`)
        } else {
          seen.set(phase, name)
        }
      }
    }
    expect(
      duplicates,
      `phases assigned to more than one step: ${duplicates.join(', ')}`,
    ).toEqual([])
  })

  it('keeps the product category in detail, never in context', () => {
    // detect no longer emits productType; the descriptions phase owns the
    // category, so `tags` must not be pulled forward into the context step.
    expect(CURATION_STEPS.detail).toContain('tags')
    expect(CURATION_STEPS.context).not.toContain('tags')
  })

  it('orders the steps by their data dependencies', () => {
    expect([...CURATION_STEP_ORDER].sort()).toEqual(Object.keys(CURATION_STEPS).sort())
    expect(CURATION_STEP_ORDER).toEqual(['context', 'image', 'detail'])
  })
})

describe('phasesForSteps', () => {
  it('expands a step into its phases in ENRICH_PHASES order', () => {
    expect(phasesForSteps(['image'])).toEqual(['images', 'classify_images'])
    expect(phasesForSteps(['context'])).toEqual([
      'clean',
      'detect',
      'slugs',
      'discover',
      'links',
    ])
  })

  it('expands every step to exactly ENRICH_PHASES', () => {
    expect(phasesForSteps([...CURATION_STEP_ORDER])).toEqual([...ENRICH_PHASES])
  })

  it('dedupes repeated steps', () => {
    expect(phasesForSteps(['image', 'image'])).toEqual(['images', 'classify_images'])
  })

  it('returns an empty list for no steps', () => {
    expect(phasesForSteps([])).toEqual([])
  })
})

describe('SERP vs enrichment stage groups', () => {
  const groups = Object.entries(ENRICH_STAGE_GROUPS) as [
    string,
    readonly string[],
  ][]

  it('assigns every ENRICH_PHASES member to a stage', () => {
    const assigned = new Set<string>(groups.flatMap(([, phases]) => phases))
    const unassigned = (ENRICH_PHASES as readonly string[]).filter(
      (phase) => !assigned.has(phase),
    )
    expect(
      unassigned,
      `phases with no stage assignment: ${unassigned.join(', ') || '(none)'} — add each to SERP_PHASES, ENRICH_LLM_PHASES, or LOCAL_PHASES`,
    ).toEqual([])
  })

  it('assigns no phase outside ENRICH_PHASES', () => {
    const all = new Set<string>(ENRICH_PHASES)
    for (const [name, phases] of groups) {
      const unknown = phases.filter((phase) => !all.has(phase))
      expect(unknown, `${name} contains unknown phases: ${unknown.join(', ')}`).toEqual([])
    }
  })

  it('assigns each phase to exactly one stage', () => {
    const seen = new Map<string, string>()
    const duplicates: string[] = []
    for (const [name, phases] of groups) {
      for (const phase of phases) {
        const owner = seen.get(phase)
        if (owner) {
          duplicates.push(`${phase} (in ${owner} and ${name})`)
        } else {
          seen.set(phase, name)
        }
      }
    }
    expect(
      duplicates,
      `phases assigned to more than one stage: ${duplicates.join(', ')}`,
    ).toEqual([])
  })

  it('keeps every pair of stage groups disjoint', () => {
    for (const [nameA, phasesA] of groups) {
      for (const [nameB, phasesB] of groups) {
        if (nameA === nameB) continue
        const overlap = phasesA.filter((phase) => phasesB.includes(phase))
        expect(overlap, `${nameA} overlaps ${nameB}: ${overlap.join(', ')}`).toEqual([])
      }
    }
  })

  it('has no duplicates within a single stage group', () => {
    for (const [name, phases] of groups) {
      expect(new Set(phases).size, `${name} has duplicate entries`).toBe(phases.length)
    }
  })

  it('routes both serper-backed search phases into the SERP stage', () => {
    expect(SERP_PHASES).toContain('discover')
    expect(SERP_PHASES).toContain('images')
  })

  it('keeps search provider phases out of the LLM stage', () => {
    // The bug this stage model fixes: TEXT_ENRICH_PHASES contains `discover`,
    // so the "text" admin preset still calls serper.dev. An enrichment-only run
    // must never hit the search provider.
    expect(ENRICH_LLM_PHASES).not.toContain('discover')
    expect(ENRICH_LLM_PHASES).not.toContain('images')
    expect(ENRICH_LLM_PHASES).toContain('classify_images')
    expect(ENRICH_LLM_PHASES).toContain('descriptions')
    expect(ENRICH_LLM_PHASES).toContain('expansion')
  })

  it('keeps LLM and serper phases out of the local stage', () => {
    expect(LOCAL_PHASES).toContain('clean')
    expect(LOCAL_PHASES).not.toContain('descriptions')
    expect(LOCAL_PHASES).not.toContain('discover')
  })
})
