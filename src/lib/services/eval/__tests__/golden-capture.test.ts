import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { PRODUCTS_LABELS } from '@/lib/prompts'
import { snapshotPrompt } from '@/lib/langfuse/prompt'
import { MAX_PROMPT_LENGTH, PROMPT_TRUNCATION_MARK } from '../../llm-audit'
import {
  GOLDEN_PROMPTS,
  capturedCallsToItems,
  classifyCapturedCall,
  harvestRowsToItems,
  promptForDataset,
  type HarvestRow,
  type PromptTexts,
  type TimedCapturedCall,
} from '../golden-capture'

// The snapshot texts: real prompts, so a shared opening between two of them
// (products vs products-propose) is exercised, not assumed away.
const TEXTS: PromptTexts = {
  'acquisition-plan': [snapshotPrompt('acquisition-plan').text],
  'acquisition-critique': [snapshotPrompt('acquisition-critique').text],
  'products-repair': [snapshotPrompt('products-repair').text],
  products: [snapshotPrompt('products').text],
}

function idOf(prompt: string, brandSlug: string, user: string): string {
  return `${prompt}:${brandSlug}:${createHash('sha256').update(user).digest('hex').slice(0, 16)}`
}

function truncated(value: string): string {
  return `${value.padEnd(MAX_PROMPT_LENGTH + 10, 'x').slice(0, MAX_PROMPT_LENGTH)}${PROMPT_TRUNCATION_MARK}`
}

const PLAN_USER = JSON.stringify({
  brand: { id: 'b1', slug: 'brand', name: 'Brand' },
  knownUrls: ['https://brand.example'],
  probeResults: [],
  budget: { probes: 4, renders: 0, search: 0, turns: 3, wallClockMs: 30000 },
})

const FALLBACK_USER = [
  PRODUCTS_LABELS.userPreamble,
  '',
  'brand content',
  '',
  `${PRODUCTS_LABELS.siteUrl}https://brand.example/`,
  '',
  PRODUCTS_LABELS.candidatePages,
  '- https://brand.example/products/plate | 陶瓷盤',
  '- https://brand.example/products/bowl',
  '',
  PRODUCTS_LABELS.listingEntryPoints,
  '- https://brand.example/collections/all',
].join('\n')

const REPAIR_USER = JSON.stringify({
  brand: { id: 'b1', slug: 'brand', name: 'Brand', url: 'https://brand.example', ownedHosts: ['brand.example'] },
  repairable: [
    { proposal: { official_url: 'https://brand.example/products/plate' }, failures: ['category_invalid: x'] },
    {
      proposal: { official_url: 'https://brand.example/products/bowl' },
      failures: ['description_origin_omitted: page states origin'],
    },
  ],
})

describe('classifyCapturedCall', () => {
  it('maps each of the four prompts by system prefix', () => {
    for (const prompt of GOLDEN_PROMPTS) {
      const system = `${TEXTS[prompt][0]}\n\nSchema trailer appended by withSchema.`
      expect(classifyCapturedCall({ system }, TEXTS)).toBe(prompt)
    }
  })

  it('matches a stored system that llm-audit truncated', () => {
    const long = `${TEXTS['acquisition-plan'][0]}`.padEnd(MAX_PROMPT_LENGTH + 500, ' tail')
    const texts = { ...TEXTS, 'acquisition-plan': [long] }
    expect(classifyCapturedCall({ system: truncated(long) }, texts)).toBe('acquisition-plan')
  })

  it('returns null for other prompts, e.g. products-propose', () => {
    expect(classifyCapturedCall({ system: snapshotPrompt('products-propose').text }, TEXTS)).toBeNull()
    expect(classifyCapturedCall({ system: 'You are something else entirely.' }, TEXTS)).toBeNull()
  })
})

describe('promptForDataset', () => {
  it('maps dataset names back to prompts', () => {
    expect(promptForDataset('products-fallback-golden')).toBe('products')
    expect(promptForDataset('acquisition-plan-golden')).toBe('acquisition-plan')
    expect(promptForDataset('nope')).toBeNull()
  })
})

function row(overrides: Partial<HarvestRow> & { user: string; system?: string }): HarvestRow {
  const { user, system, ...rest } = overrides
  return {
    created_at: '2026-09-10T00:00:00.000Z',
    job_id: 'job-1',
    brand_slug: 'brand',
    input: { system: system ?? TEXTS['acquisition-plan'][0], user },
    ...rest,
  }
}

describe('harvestRowsToItems', () => {
  it('skips rows whose input.user ends with the truncation mark', () => {
    const items = harvestRowsToItems(
      [row({ user: truncated(PLAN_USER), job_id: 'job-cut' }), row({ user: PLAN_USER })],
      { prompt: 'acquisition-plan', texts: TEXTS },
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.input).toBe(PLAN_USER)
  })

  it('keeps one plan item per (job_id, brand): the first turn', () => {
    const later = PLAN_USER.replace('"probeResults":[]', '"probeResults":[{"url":"https://brand.example/later"}]')
    const items = harvestRowsToItems(
      [
        row({ user: later, created_at: '2026-09-10T00:00:02.000Z' }),
        row({ user: PLAN_USER, created_at: '2026-09-10T00:00:01.000Z' }),
        row({ user: later, created_at: '2026-09-10T00:00:03.000Z', job_id: 'job-2' }),
      ],
      { prompt: 'acquisition-plan', texts: TEXTS },
    )
    expect(items.map((i) => [i.id, i.metadata.jobId])).toEqual([
      [idOf('acquisition-plan', 'brand', PLAN_USER), 'job-1'],
      [idOf('acquisition-plan', 'brand', later), 'job-2'],
    ])
  })

  it('keeps one plan item per brand when a job spans several brands', () => {
    const other = PLAN_USER.replace('"slug":"brand"', '"slug":"other"')
    const items = harvestRowsToItems(
      [
        row({ user: PLAN_USER, created_at: '2026-09-10T00:00:01.000Z' }),
        row({ user: other, brand_slug: 'other', created_at: '2026-09-10T00:00:02.000Z' }),
        row({ user: PLAN_USER, created_at: '2026-09-10T00:00:03.000Z' }),
      ],
      { prompt: 'acquisition-plan', texts: TEXTS },
    )
    expect(items.map((i) => i.metadata.brandSlug)).toEqual(['brand', 'other'])
  })

  it('collapses plan-loop turns with no job_id that repeat the same user message', () => {
    const items = harvestRowsToItems(
      [
        row({ user: PLAN_USER, job_id: null, created_at: '2026-09-10T00:00:01.000Z' }),
        row({ user: PLAN_USER, job_id: null, created_at: '2026-09-10T00:00:02.000Z' }),
        row({ user: PLAN_USER, job_id: null, created_at: '2026-09-10T00:00:03.000Z' }),
      ],
      { prompt: 'acquisition-plan', texts: TEXTS },
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe(idOf('acquisition-plan', 'brand', PLAN_USER))
  })

  it('keeps only rows that classify to the requested prompt and are on or after --since', () => {
    const items = harvestRowsToItems(
      [
        row({ user: PLAN_USER, created_at: '2026-09-01T00:00:00.000Z', job_id: 'old' }),
        row({ user: PLAN_USER, system: TEXTS['acquisition-critique'][0], job_id: 'critique' }),
        row({ user: PLAN_USER, job_id: 'kept' }),
      ],
      { prompt: 'acquisition-plan', texts: TEXTS, since: '2026-09-05' },
    )
    expect(items.map((i) => i.metadata.jobId)).toEqual(['kept'])
  })

  it('items are written ARCHIVED with a pending humanApproval', () => {
    const [item] = harvestRowsToItems([row({ user: PLAN_USER })], { prompt: 'acquisition-plan', texts: TEXTS })
    expect(item).toMatchObject({
      datasetName: 'acquisition-plan-golden',
      input: PLAN_USER,
      status: 'ARCHIVED',
      expectedOutput: { context: {} },
      metadata: { source: 'harvest', brandSlug: 'brand', jobId: 'job-1', humanApproval: { status: 'pending' } },
    })
  })

  it('derives the repair context from the stored user message', () => {
    const [item] = harvestRowsToItems(
      [row({ user: REPAIR_USER, system: TEXTS['products-repair'][0] })],
      { prompt: 'products-repair', texts: TEXTS },
    )
    expect(item!.expectedOutput).toEqual({
      context: {
        siteUrl: 'https://brand.example',
        candidates: ['https://brand.example/products/plate', 'https://brand.example/products/bowl'],
        ownedHosts: ['brand.example'],
        hardUrls: ['https://brand.example/products/plate'],
      },
    })
  })
})

describe('capturedCallsToItems', () => {
  function call(system: string, user: string, capturedAt: string): TimedCapturedCall {
    return { phase: 'products', profileKey: 'products', system, user, promptName: null, capturedAt }
  }

  it('maps captured calls, derives the fallback context, and leaves critique unlabeled', () => {
    const items = capturedCallsToItems(
      [
        call(TEXTS.products[0]!, FALLBACK_USER, '2026-09-26T00:00:01.000Z'),
        call(TEXTS['acquisition-critique'][0]!, '{"brand":{}}', '2026-09-26T00:00:02.000Z'),
        call(snapshotPrompt('products-propose').text, 'ignored', '2026-09-26T00:00:03.000Z'),
      ],
      { brandSlug: 'brand', jobId: 'run-1', texts: TEXTS },
    )
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      datasetName: 'products-fallback-golden',
      id: idOf('products', 'brand', FALLBACK_USER),
      expectedOutput: {
        context: {
          siteUrl: 'https://brand.example/',
          candidates: ['https://brand.example/products/plate', 'https://brand.example/products/bowl'],
          ownedHosts: [],
        },
      },
      metadata: { source: 'capture', jobId: 'run-1' },
    })
    expect(items[1]).toMatchObject({ datasetName: 'acquisition-critique-golden', expectedOutput: null })
  })

  it('derives the id from the user message, so a re-capture keeps the same id', () => {
    const options = { brandSlug: 'brand', jobId: 'run-1', texts: TEXTS }
    const first = capturedCallsToItems([call(TEXTS.products[0]!, FALLBACK_USER, '2026-09-26T00:00:01.000Z')], options)
    const second = capturedCallsToItems(
      [call(TEXTS.products[0]!, FALLBACK_USER, '2026-09-27T09:30:00.000Z')],
      { ...options, jobId: 'run-2' },
    )
    expect(first[0]!.id).toBe(second[0]!.id)
  })

  it('gives different users captured in the same millisecond different ids', () => {
    const otherUser = FALLBACK_USER.replace('products/bowl', 'products/cup')
    const items = capturedCallsToItems(
      [
        call(TEXTS.products[0]!, FALLBACK_USER, '2026-09-26T00:00:01.000Z'),
        call(TEXTS.products[0]!, otherUser, '2026-09-26T00:00:01.000Z'),
      ],
      { brandSlug: 'brand', jobId: 'run-1', texts: TEXTS },
    )
    expect(items).toHaveLength(2)
    expect(items[0]!.id).not.toBe(items[1]!.id)
  })

  it('reads only candidate URL lines: evidence with newlines neither ends nor pollutes the pool', () => {
    const user = [
      PRODUCTS_LABELS.userPreamble,
      '',
      `${PRODUCTS_LABELS.siteUrl}https://brand.example/`,
      '',
      PRODUCTS_LABELS.candidatePages,
      '- https://brand.example/products/plate | 陶瓷盤 / 第一行',
      '手工製作，第二行',
      '',
      '- 不是網址的列點',
      '- https://brand.example/products/bowl | 碗',
      '',
      PRODUCTS_LABELS.listingEntryPoints,
      '- https://brand.example/collections/all',
      '',
      PRODUCTS_LABELS.originExcerpts,
      '- https://brand.example/products/plate | e1 | 台灣製',
    ].join('\n')
    const [item] = capturedCallsToItems([call(TEXTS.products[0]!, user, '2026-09-26T00:00:01.000Z')], {
      brandSlug: 'brand',
      jobId: 'run-1',
      texts: TEXTS,
    })
    expect((item!.expectedOutput as { context: { candidates: string[] } }).context.candidates).toEqual([
      'https://brand.example/products/plate',
      'https://brand.example/products/bowl',
    ])
  })

  it('keeps only the requested prompts', () => {
    const items = capturedCallsToItems(
      [call(TEXTS.products[0]!, FALLBACK_USER, '2026-09-26T00:00:01.000Z')],
      { brandSlug: 'brand', jobId: 'run-1', texts: TEXTS, prompts: ['acquisition-plan'] },
    )
    expect(items).toEqual([])
  })
})
