import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { LLM_PROFILES } from '@/lib/constants/llm-models'
import { createAcquisitionTools } from '../../enrich-phases/acquisition/tools'
import { PRODUCTS_SCHEMA } from '../../enrich-phases/products'
import { REPAIR_SCHEMA } from '../../enrich-phases/products/graph'
import {
  ACQUIRE_CRITIQUE_SCHEMA_NAME,
  ACQUIRE_PLAN_TOOL_NAME,
  PRODUCTS_PROPOSE_SCHEMA_NAME,
  PRODUCTS_REPAIR_SCHEMA_NAME,
  REPLAY_STEPS,
  classifyReplayRow,
} from '../request-replay-steps'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const single = (extra: Record<string, unknown> = {}) => ({ v: 1, system: 'sys', user: 'usr', ...extra })
const messages = (extra: Record<string, unknown> = {}) => ({
  v: 1,
  messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }],
  ...extra,
})
const tool = (name: string) => ({ name, description: `${name} tool`, parameters: {} })
const schema = (name: string) => ({ name, schema: {} })

function stepOf(phase: string, request: unknown): string | null {
  return classifyReplayRow({ phase, request })?.name ?? null
}

// ---------------------------------------------------------------------------
// classifyReplayRow
// ---------------------------------------------------------------------------

describe('classifyReplayRow', () => {
  it('maps phase descriptions with system to descriptions', () => {
    expect(stepOf('descriptions', single({ schema: schema('brand_description') }))).toBe('descriptions')
  })

  it('maps phase descriptions with messages to editorial_repair', () => {
    expect(stepOf('descriptions', messages({ schema: schema('editorial_repair') }))).toBe('editorial_repair')
  })

  it('maps phase acquire with a submit_plan tool to acquire_plan', () => {
    expect(
      stepOf('acquire', messages({ tools: [tool('probe_static'), tool(ACQUIRE_PLAN_TOOL_NAME)] })),
    ).toBe('acquire_plan')
  })

  it('maps schema critique_verdict to acquire_critique', () => {
    expect(stepOf('acquire', messages({ schema: schema(ACQUIRE_CRITIQUE_SCHEMA_NAME) }))).toBe('acquire_critique')
  })

  it('maps schema curated_product_proposals to products_propose', () => {
    expect(stepOf('products', messages({ schema: schema(PRODUCTS_PROPOSE_SCHEMA_NAME) }))).toBe('products_propose')
  })

  it('maps schema curated_product_repair to products_repair', () => {
    expect(stepOf('products', messages({ schema: schema(PRODUCTS_REPAIR_SCHEMA_NAME) }))).toBe('products_repair')
  })

  it('maps phase products with system to products_fallback, even with the proposals schema', () => {
    expect(stepOf('products', single({ schema: schema(PRODUCTS_PROPOSE_SCHEMA_NAME) }))).toBe('products_fallback')
  })

  it.each([
    'detect',
    'facts',
    'founding_facts',
    'founding_facts_verify',
    'faq',
    'names',
    'classify_images',
  ])('maps single-call phase %s 1:1', (phase) => {
    expect(stepOf(phase, single())).toBe(phase)
  })

  it.each([
    ['an unknown phase', 'stockists', single()],
    ['an acquire turn without submit_plan or critique schema', 'acquire', messages({ tools: [tool('probe_static')] })],
    ['an acquire single call', 'acquire', single()],
    ['a products agent turn with another schema', 'products', messages({ schema: schema('product_selection') })],
    ['a products agent turn without schema', 'products', messages()],
    ['a single-call phase sent as messages', 'detect', messages()],
    ['a request with neither system nor messages', 'detect', { v: 1 }],
    ['a null request', 'detect', null],
  ])('returns null for %s', (_label, phase, request) => {
    expect(classifyReplayRow({ phase, request })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Pinned discriminators
// ---------------------------------------------------------------------------

describe('discriminator names are pinned to their source constants', () => {
  it('submit_plan matches the acquisition tool definition', () => {
    const tools = createAcquisitionTools(
      { fetchHtml: async () => ({ text: '', status: 200, latencyMs: 0, error: null }) as never },
      {
        allowlist: { knownUrls: new Set(), discoveredUrls: new Set() },
        budget: {
          allowed: { probes: 1, renders: 1, search: 1, turns: 1, wallClockMs: 1 },
          used: { probes: 0, renders: 0, search: 0, turns: 0, wallClockMs: 0 },
        },
      },
    )
    expect(tools.map((t) => t.definition.name)).toContain(ACQUIRE_PLAN_TOOL_NAME)
  })

  it('critique_verdict matches CRITIQUE_SCHEMA in acquisition/graph.ts', () => {
    // CRITIQUE_SCHEMA is module-private, so the pin reads the source.
    const source = readFileSync(join(__dirname, '../../enrich-phases/acquisition/graph.ts'), 'utf8')
    const match = /const CRITIQUE_SCHEMA[^=]*=\s*\{\s*name:\s*['"]([^'"]+)['"]/.exec(source)
    expect(match?.[1]).toBe(ACQUIRE_CRITIQUE_SCHEMA_NAME)
  })

  it('curated_product_proposals matches PRODUCTS_SCHEMA', () => {
    expect(PRODUCTS_SCHEMA.name).toBe(PRODUCTS_PROPOSE_SCHEMA_NAME)
  })

  it('curated_product_repair matches REPAIR_SCHEMA', () => {
    expect(REPAIR_SCHEMA.name).toBe(PRODUCTS_REPAIR_SCHEMA_NAME)
  })
})

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

describe('REPLAY_STEPS', () => {
  it('lists every catalog step once, without stockists', () => {
    expect(REPLAY_STEPS.map((s) => s.name)).toEqual([
      'detect',
      'facts',
      'founding_facts',
      'founding_facts_verify',
      'faq',
      'names',
      'classify_images',
      'descriptions',
      'editorial_repair',
      'acquire_plan',
      'acquire_critique',
      'products_propose',
      'products_repair',
      'products_fallback',
    ])
    expect(REPLAY_STEPS.some((s) => s.phases.includes('stockists') || s.profileKey === 'stockists')).toBe(false)
  })

  it.each(REPLAY_STEPS.map((s) => [s.name, s] as const))('%s has a real profile key and a hint entry', (_name, step) => {
    expect(Object.keys(LLM_PROFILES)).toContain(step.profileKey)
    expect(step.keyFields.length + step.proseFields.length).toBeGreaterThan(0)
    expect(step.keyFields.filter((f) => step.proseFields.includes(f))).toEqual([])
    expect(step.phases.length).toBeGreaterThan(0)
  })

  it('maps acquire_plan to the acquisition profile and excludes stockists', () => {
    expect(REPLAY_STEPS.find((s) => s.name === 'acquire_plan')?.profileKey).toBe('acquisition')
    expect(REPLAY_STEPS.find((s) => s.name === 'stockists')).toBeUndefined()
  })
})
