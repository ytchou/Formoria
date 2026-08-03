import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  AUDITED_PHASES,
  CURATION_STEPS,
  DEFERRED_PHASES,
  CURATION_STEP_ORDER,
  ENRICH_LLM_PHASES,
  ENRICH_PHASES,
  ENRICH_STAGE_GROUPS,
  IMAGE_ENRICH_PHASES,
  LOCAL_PHASES,
  SERP_PHASES,
  SUB_PHASES,
  TEXT_ENRICH_PHASES,
  isDeferredPhase,
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

describe('sub-phases', () => {
  it('keeps sub-phases out of ENRICH_PHASES', () => {
    // A sub-phase is not selectable, so it must never reach `params.phases`,
    // `phasesForSteps` or any `phases.includes(...)` gate.
    const all = new Set<string>(ENRICH_PHASES)
    for (const phase of SUB_PHASES) {
      expect(all.has(phase), `${phase} is both a phase and a sub-phase`).toBe(false)
    }
  })

  it('assigns no sub-phase to a step', () => {
    const assigned = new Set<string>(
      Object.values(CURATION_STEPS).flatMap((phases) => [...phases]),
    )
    for (const phase of SUB_PHASES) {
      expect(assigned.has(phase), `${phase} is a sub-phase but selectable via a step`).toBe(false)
    }
  })

  it('unions the two sets into AUDITED_PHASES with no duplicates', () => {
    expect([...AUDITED_PHASES].sort()).toEqual(
      [...ENRICH_PHASES, ...SUB_PHASES].sort(),
    )
    expect(new Set(AUDITED_PHASES).size).toBe(AUDITED_PHASES.length)
  })
})

describe('audited phase coverage', () => {
  // Phase strings that are job-level, not brand-level: they are never written
  // to `brand_ai_results.phase` and never appear in a target's phase_results.
  const NON_BRAND_PHASES = new Set(['preflight', 'job'])

  const servicesDir = fileURLToPath(new URL('../../services', import.meta.url))

  function collectPhaseLiterals(): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>()
    const entries = readdirSync(servicesDir, { recursive: true }) as string[]
    for (const entry of entries) {
      if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue
      if (entry.includes('__tests__') || entry.includes('.test.')) continue
      const source = readFileSync(`${servicesDir}/${entry}`, 'utf8')
      const patterns = [
        /buildPhaseResult\(\s*['"]([a-z_-]+)['"]/g,
        /\bphase:\s*['"]([a-z_-]+)['"]/g,
      ]
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          const phase = match[1]
          if (!phase) continue
          const files = found.get(phase) ?? new Set<string>()
          files.add(entry)
          found.set(phase, files)
        }
      }
    }
    return found
  }

  it('covers every phase string the services can write with a constant', () => {
    // The regression this catches: `facts` was written to
    // `brand_ai_results.phase` for weeks while being absent from every phase
    // constant, so neither the coverage test nor the admin UI knew it existed.
    const literals = collectPhaseLiterals()
    const known = new Set<string>(AUDITED_PHASES)
    const uncovered = [...literals.entries()]
      .filter(([phase]) => !known.has(phase) && !NON_BRAND_PHASES.has(phase))
      .map(([phase, files]) => `${phase} (${[...files].sort().join(', ')})`)
    expect(
      uncovered,
      `phase strings written by the services but present in no constant: ${uncovered.join('; ')} — add each to ENRICH_PHASES or SUB_PHASES`,
    ).toEqual([])
  })

  it('finds the known phase writers, so the scan cannot silently match nothing', () => {
    const literals = collectPhaseLiterals()
    for (const phase of ['facts', 'descriptions', 'locations', 'classification']) {
      expect(literals.has(phase), `scan found no writer for ${phase}`).toBe(true)
    }
  })
})

describe('deferred phases', () => {
  it('reports exactly the DEFERRED_PHASES members as deferred', () => {
    for (const phase of DEFERRED_PHASES) expect(isDeferredPhase(phase)).toBe(true)
    for (const phase of ENRICH_PHASES) {
      if ((DEFERRED_PHASES as readonly string[]).includes(phase)) continue
      expect(isDeferredPhase(phase), `${phase} is not deferred`).toBe(false)
    }
    expect(isDeferredPhase('not-a-phase')).toBe(false)
  })
})

describe('curation steps', () => {
  const steps = Object.entries(CURATION_STEPS) as [string, readonly string[]][]

  it('assigns every ENRICH_PHASES member to a step, except deferred ones', () => {
    const assigned = new Set<string>(steps.flatMap(([, phases]) => phases))
    const unassigned = (ENRICH_PHASES as readonly string[]).filter(
      (phase) => !assigned.has(phase),
    )
    expect(
      unassigned,
      `phases with no step assignment: ${unassigned.join(', ') || '(none)'} — add each to CURATION_STEPS.context, .image or .detail, or to DEFERRED_PHASES if the omission is deliberate`,
    ).toEqual([...DEFERRED_PHASES])
  })

  it('runs no deferred phase', () => {
    const assigned = new Set<string>(steps.flatMap(([, phases]) => phases))
    for (const phase of DEFERRED_PHASES) {
      expect(assigned.has(phase), `${phase} is deferred but still assigned to a step`).toBe(false)
    }
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

  it('expands every step to ENRICH_PHASES minus the deferred ones', () => {
    const expected = (ENRICH_PHASES as readonly string[]).filter(
      (phase) => !(DEFERRED_PHASES as readonly string[]).includes(phase),
    )
    expect(phasesForSteps([...CURATION_STEP_ORDER])).toEqual(expected)
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
    // Stages are a property of *selectable* phases only. A sub-phase inherits
    // the stage of the phase that owns it (`facts` is billed to `descriptions`),
    // so listing one here would double-count it.
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
    expect(ENRICH_LLM_PHASES).toContain('reputation')
  })

  it('keeps LLM and serper phases out of the local stage', () => {
    expect(LOCAL_PHASES).toContain('clean')
    expect(LOCAL_PHASES).not.toContain('descriptions')
    expect(LOCAL_PHASES).not.toContain('discover')
  })
})
