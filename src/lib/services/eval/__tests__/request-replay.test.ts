import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { getAuditContext, runWithAuditContext, type AuditRecord } from '@/lib/audit'
import type { CapturedCall } from '../../llm-audit'
import type { ReplayRow, ReplayRowReader } from '../request-replay-load'
import type { ChatInput, ImageRebuildDeps } from '../request-replay-request'
import { REPLAY_STEPS } from '../request-replay-steps'
import {
  requestReplayTask,
  runRequestReplay,
  storedImageLoaders,
  type ReplayChatResult,
  type RequestReplayDeps,
} from '../request-replay'
import type { AuditCollector } from '../zero-write'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHALLENGER = 'gpt-6-luna'
const STORED_A = 'gpt-5.4-mini'
const STORED_B = 'gpt-5-nano'
const IMAGE_ID = '0b9a1c52-4f3e-4d7a-9c11-6f2e8d0a5b01'
const DATA_URI = 'data:image/jpeg;base64,AAAA'

const DETECT_ANSWER = { isNonBrand: false, confidence: 'high', reasoning: 'a brand', nonBrandReason: null }
const CLASSIFY_ANSWER = { classifications: [{ disposition: 'keep', tag: 'product', reasons: [], caption: 'a cup' }] }

function stored(answer: unknown, ok = true) {
  return ok
    ? { provider: 'openai', ok: true, status: 200, response: { choices: [{ message: { content: JSON.stringify(answer) } }] } }
    : { provider: 'openai', ok: false, status: 500, response: null, error: 'boom' }
}

let clock = 0
function row(overrides: Partial<ReplayRow> & { id: string }): ReplayRow {
  clock++
  return {
    phase: 'detect',
    model: STORED_A,
    createdAt: `2026-10-04T00:00:${String(clock % 60).padStart(2, '0')}.000Z`,
    brandId: `brand-${overrides.id}`,
    submissionId: null,
    submissionBrandId: null,
    jobId: null,
    auditSpanId: `span-${overrides.id}`,
    request: { v: 1, system: 'detect system', user: `user ${overrides.id}`, json: true },
    rawResponse: stored(DETECT_ANSWER),
    meta: null,
    ...overrides,
  }
}

function classifyRow(id: string, ids: string[] = [IMAGE_ID]): ReplayRow {
  return row({
    id,
    phase: 'classify_images',
    request: {
      v: 1,
      system: 'classify system',
      user: `classify ${id}`,
      json: true,
      images: ids.map(() => ({ omitted: 'data-uri' })),
      meta: { imageIds: ids },
    },
    rawResponse: stored(CLASSIFY_ANSWER),
  })
}

/** Serves every row on the first page, filtered by phase, then an empty page. */
function reader(rows: ReplayRow[]): ReplayRowReader {
  return async (range, filter) =>
    range.from === 0 ? rows.filter((r) => filter.phases.includes(r.phase)) : []
}

function collector(): AuditCollector {
  const records: AuditRecord[] = []
  return {
    push: (record) => records.push(record),
    byCorrelation: (id) => records.filter((r) => r.correlationId === id),
    all: () => [...records],
  }
}

type ChatCall = { profileKey: string; context: unknown; model: string; input: ChatInput }

type Harness = {
  deps: RequestReplayDeps
  events: string[]
  chatCalls: ChatCall[]
  imageLoads: string[]
  asserts: Array<{ correlationIds: string[]; spanIds: string[] }>
  restored: () => boolean
}

/**
 * Fake deps through the real `runItems`. The fake chat records each call as an
 * audit record under the item's correlation id (as the audited client does),
 * reporting `reportModel(model)` as the model the call went to.
 */
function harness(
  rows: ReplayRow[],
  opts: {
    answer?: (input: ChatInput, model: string) => unknown
    reportModel?: (model: string) => string
    paramFallbackFor?: (model: string) => boolean
    loadStoredImage?: ImageRebuildDeps['loadStoredImage']
  } = {},
): Harness {
  const events: string[] = []
  const chatCalls: ChatCall[] = []
  const imageLoads: string[] = []
  const asserts: Harness['asserts'] = []
  let restored = false
  let seam: ((call: CapturedCall) => void) | null = null
  const auditCollector = collector()

  const deps: RequestReplayDeps = {
    readRows: reader(rows),
    images: {
      loadStoredImage:
        opts.loadStoredImage ??
        (async (_table, id) => {
          imageLoads.push(id)
          return DATA_URI
        }),
      loadBySourceUrl: async () => null,
      fetchVisionImage: async () => null,
    },
    createProfiledOpenAIClient: (profileKey, context, options) => ({
      chat: async (input): Promise<ReplayChatResult> => {
        const model = options.model
        events.push(`chat:${model}`)
        chatCalls.push({ profileKey, context, model, input })
        auditCollector.push({
          spanId: randomUUID(),
          correlationId: getAuditContext().correlationId!,
          kind: 'external',
          status: 'succeeded',
          provider: 'openai',
          operation: 'chat_completions',
          latencyMs: 10,
          costUsd: 0.001,
          promptTokens: 100,
          completionTokens: 10,
          model: opts.reportModel?.(model) ?? model,
        })
        if (opts.paramFallbackFor?.(model)) {
          seam?.({
            phase: 'detect',
            profileKey: null,
            system: '',
            user: '',
            promptName: null,
            messages: [],
            response: { content: null },
            paramFallback: ['temperature->omitted'],
          })
        }
        const answer = opts.answer ? opts.answer(input, model) : DETECT_ANSWER
        return { ok: true, status: 200, content: JSON.stringify(answer), toolCalls: null }
      },
    }),
    installSeams: () => {
      events.push('installSeams')
      return {
        collector: auditCollector,
        restore: () => {
          restored = true
        },
      }
    },
    assertNoNewAuditRows: async ({ correlationIds, spanIds }) => {
      asserts.push({ correlationIds, spanIds })
    },
    runWithAuditContext,
    getAuditContext,
    setChatCaptureSeam: (fn) => {
      seam = fn
    },
    resetLearnedParamShapes: () => {
      events.push('reset')
    },
    writeFile: async () => undefined,
    now: () => new Date('2026-10-05T00:00:00.000Z'),
  }

  return { deps, events, chatCalls, imageLoads, asserts, restored: () => restored }
}

const options = { challengerModel: CHALLENGER, limit: 50, panelMax: 30, seed: 'test-seed' }

// ---------------------------------------------------------------------------
// runRequestReplay
// ---------------------------------------------------------------------------

describe('runRequestReplay', () => {
  it('runs the challenger arm and one incumbent arm per distinct stored model, resetting param shapes before each arm', async () => {
    const h = harness([
      row({ id: 'd1', model: STORED_A }),
      row({ id: 'd2', model: STORED_A }),
      row({ id: 'd3', model: STORED_B }),
    ])

    const result = await runRequestReplay({ ...options, steps: ['detect'] }, h.deps)

    const byModel = (model: string) => h.chatCalls.filter((c) => c.model === model).length
    expect(byModel(CHALLENGER)).toBe(3)
    expect(byModel(STORED_A)).toBe(2)
    expect(byModel(STORED_B)).toBe(1)

    // Three arms, each preceded by a reset; no arm's calls interleave with another's.
    const armOrder = h.events.filter((e) => e !== 'installSeams')
    expect(armOrder.filter((e) => e === 'reset')).toHaveLength(3)
    const segments = armOrder.join(',').split('reset').slice(1).map((s) => s.split(',').filter(Boolean))
    expect(segments.map((s) => new Set(s).size)).toEqual([1, 1, 1])
    expect(h.events[0]).toBe('installSeams')

    // D3: the client is built without a target.
    for (const call of h.chatCalls) {
      expect(call.profileKey).toBe('detect')
      expect(call.context).toEqual({ phase: 'detect' })
      expect(call.context).not.toHaveProperty('target')
    }
    // The logged request is re-sent without its `v` marker.
    expect(h.chatCalls[0]!.input).not.toHaveProperty('v')

    expect(result.tables).toHaveLength(1)
    const stats = result.tables[0]!.stats
    expect(stats.spans).toBe(3)
    expect(stats.distinctBrands).toBe(3)
    expect(stats.challengerAgreement).toBe(1)
    expect(stats.noiseFloorAgreement).toBe(1)
    expect(stats.offSlot).toBe(0)
    expect(stats.underPowered).toBe(true)

    expect(h.asserts).toHaveLength(1)
    expect(h.asserts[0]!.correlationIds.length).toBeGreaterThanOrEqual(6)
    expect(h.asserts[0]!.spanIds).toHaveLength(6)
    expect(h.restored()).toBe(true)
  })

  it('loads each span’s images once, before the arms, and sends them on every arm', async () => {
    const h = harness([classifyRow('c1'), classifyRow('c2')], { answer: () => CLASSIFY_ANSWER })

    const result = await runRequestReplay({ ...options, steps: ['classify_images'] }, h.deps)

    // Two spans x one image, though each span ran on two arms.
    expect(h.imageLoads).toEqual([IMAGE_ID, IMAGE_ID])
    expect(h.chatCalls).toHaveLength(4)
    for (const call of h.chatCalls) expect(call.input.images).toEqual([DATA_URI])
    expect(result.tables[0]!.images).toEqual({ rebuiltSpans: 2, rebuiltImages: 2, skippedSpans: 0 })
  })

  it('never sends a prod-failed span or an image-skip span to chat, and counts both as skips', async () => {
    const h = harness(
      [
        row({ id: 'ok1' }),
        row({ id: 'bad1', rawResponse: stored(null, false) }),
        classifyRow('lost1'),
      ],
      { loadStoredImage: async () => null },
    )

    const result = await runRequestReplay({ ...options, steps: ['detect', 'classify_images'] }, h.deps)

    const users = h.chatCalls.map((c) => c.input.user)
    expect(users.every((u) => u === 'user ok1')).toBe(true)
    expect(h.chatCalls).toHaveLength(2)

    const [detect, classify] = result.tables
    expect(detect!.stats.skips['prod-failed']).toBe(1)
    expect(detect!.stats.spans).toBe(2)
    expect(classify!.stats.skips.image).toBe(1)
    expect(classify!.images).toEqual({ rebuiltSpans: 0, rebuiltImages: 0, skippedSpans: 1 })
  })

  it('skips a span whose image lookup throws, counts it as an image skip and keeps the run going', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const h = harness([classifyRow('broken1', [IMAGE_ID, 'not-a-uuid-later']), classifyRow('fine1')], {
      answer: () => CLASSIFY_ANSWER,
      loadStoredImage: async (_table, id) => {
        if (id === 'not-a-uuid-later') throw new Error('[replay] brand_images read failed: invalid input syntax for type uuid')
        return DATA_URI
      },
    })

    const result = await runRequestReplay({ ...options, steps: ['classify_images'] }, h.deps)

    expect(h.chatCalls.map((c) => c.input.user)).toEqual(['classify fine1', 'classify fine1'])
    expect(result.tables[0]!.stats.skips.image).toBe(1)
    expect(result.tables[0]!.images).toEqual({ rebuiltSpans: 1, rebuiltImages: 1, skippedSpans: 1 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('span-broken1')
    expect(String(warn.mock.calls[0]![0])).toContain('invalid input syntax')
    warn.mockRestore()
  })

  it('makes no arm call and skips the zero-write assertion when every step is empty', async () => {
    const h = harness([])

    const result = await runRequestReplay({ ...options, steps: ['faq'] }, h.deps)

    expect(h.chatCalls).toHaveLength(0)
    expect(h.events).not.toContain('reset')
    expect(h.asserts).toHaveLength(0)
    expect(h.restored()).toBe(true)
    expect(result.tables[0]!.stats.spans).toBe(0)
    expect(result.tables[0]!.markdown).toContain('n=0')
  })

  it('marks a call that reports another model as off-slot and counts it in the report', async () => {
    const h = harness([row({ id: 'd1' }), row({ id: 'd2' })], {
      reportModel: (model) => (model === CHALLENGER ? 'gpt-somebody-else' : model),
    })

    const result = await runRequestReplay({ ...options, steps: ['detect'] }, h.deps)

    const stats = result.tables[0]!.stats
    expect(stats.offSlot).toBe(2)
    // An off-slot call is not scored as the challenger's answer.
    expect(stats.challengerAgreement).toBeNull()
    expect(stats.noiseFloorAgreement).toBe(1)
    expect(result.summary).toContain('off-slot calls: 2')
  })

  it('counts calls whose request shape was changed by a learned param fallback', async () => {
    const h = harness([row({ id: 'd1' }), row({ id: 'd2' })], {
      paramFallbackFor: (model) => model === CHALLENGER,
    })

    const result = await runRequestReplay({ ...options, steps: ['detect'] }, h.deps)

    expect(result.tables[0]!.stats.paramFallback).toBe(2)
  })

  it('returns one table per catalog step in catalog order, plus a summary, whatever order the steps were asked in', async () => {
    const h = harness([row({ id: 'd1' })])
    const names = REPLAY_STEPS.map((s) => s.name)

    const result = await runRequestReplay({ ...options, steps: [...names].reverse() }, h.deps)

    expect(result.tables.map((t) => t.step)).toEqual(names)
    expect(result.summary).toContain('rows read')
    expect(h.asserts).toHaveLength(1)
  })

  it('rejects an unknown step before installing seams', async () => {
    const h = harness([])

    await expect(runRequestReplay({ ...options, steps: ['nope'] }, h.deps)).rejects.toThrow(/Unknown replay step: nope/)
    expect(h.events).not.toContain('installSeams')
  })

  it('restores the seams when the run throws', async () => {
    const h = harness([])
    h.deps.readRows = async () => {
      throw new Error('read failed')
    }

    await expect(runRequestReplay({ ...options, steps: ['detect'] }, h.deps)).rejects.toThrow('read failed')
    expect(h.restored()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// storedImageLoaders
// ---------------------------------------------------------------------------

type ImageRowFixture = { storage_path: string | null; url: string | null }

/** A read-only stand-in for the PostgREST chain the loaders use; records each lookup. */
function imageClient(tables: Record<string, Array<ImageRowFixture & Record<string, string | null>>>) {
  const reads: Array<{ table: string; columns: string; match: Record<string, string> }> = []
  const client = {
    from: (table: string) => ({
      select: (columns: string) => ({
        match: (match: Record<string, string>) => ({
          maybeSingle: async () => {
            reads.push({ table, columns, match })
            const hit = (tables[table] ?? []).find((r) => Object.entries(match).every(([k, v]) => r[k] === v))
            return { data: hit ? { storage_path: hit.storage_path, url: hit.url } : null, error: null }
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient
  return { client, reads }
}

describe('storedImageLoaders', () => {
  const SUBMISSION_IMAGE_ID = '7c1d2e3f-0a4b-4c5d-8e6f-9a0b1c2d3e4f'
  const PUBLIC_URL = 'https://example.supabase.co/storage/v1/object/public/brand-images/brands/x.jpg'

  it('passes storage_path and url to loadVisionDataUri, as classify-images does', async () => {
    const { client, reads } = imageClient({ brand_images: [{ id: IMAGE_ID, storage_path: null, url: PUBLIC_URL }] })
    const loaded: ImageRowFixture[] = []

    const uri = await storedImageLoaders(client, async (image) => {
      loaded.push(image)
      return DATA_URI
    }).loadStoredImage('brand_images', IMAGE_ID)

    expect(uri).toBe(DATA_URI)
    expect(loaded).toEqual([{ storage_path: null, url: PUBLIC_URL }])
    expect(reads[0]!.columns).toBe('storage_path, url')
  })

  it('falls back to submission_images by the same id when brand_images has no such row', async () => {
    const { client, reads } = imageClient({
      brand_images: [],
      submission_images: [{ id: SUBMISSION_IMAGE_ID, storage_path: 'submissions/s/1.jpg', url: null }],
    })

    const uri = await storedImageLoaders(client, async (image) => `data:${image.storage_path}`).loadStoredImage(
      'brand_images',
      SUBMISSION_IMAGE_ID,
    )

    expect(uri).toBe('data:submissions/s/1.jpg')
    expect(reads.map((r) => r.table)).toEqual(['brand_images', 'submission_images'])
  })

  it('returns null when neither table has the id', async () => {
    const { client } = imageClient({ brand_images: [], submission_images: [] })

    const uri = await storedImageLoaders(client, async () => DATA_URI).loadStoredImage('brand_images', IMAGE_ID)

    expect(uri).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// requestReplayTask
// ---------------------------------------------------------------------------

describe('requestReplayTask', () => {
  const detect = REPLAY_STEPS.find((s) => s.name === 'detect')!
  const item = {
    id: 'span-task',
    input: { step: detect, phase: 'detect', chatInput: { system: 's', user: 'u', json: true } },
    expectedOutput: null,
    humanApproval: {},
  }

  it('builds the profiled client without a target and normalizes the fresh answer', async () => {
    const built: unknown[] = []
    const task = requestReplayTask({
      createProfiledOpenAIClient: (profileKey, context, options) => {
        built.push({ profileKey, context, options })
        return { chat: async () => ({ ok: true, status: 200, content: ' {"isNonBrand":true} ', toolCalls: null }) }
      },
    })

    const result = await task(item, CHALLENGER)

    expect(built).toEqual([{ profileKey: 'detect', context: { phase: 'detect' }, options: { model: CHALLENGER } }])
    expect(result).toEqual({ ok: true, output: { kind: 'json', value: { isNonBrand: true } } })
  })

  it('fails the item on a non-ok chat result', async () => {
    const task = requestReplayTask({
      createProfiledOpenAIClient: () => ({
        chat: async () => ({ ok: false, status: 429, content: null, toolCalls: null }),
      }),
    })

    expect(await task(item, CHALLENGER)).toEqual({ ok: false, output: null, error: 'chat failed: HTTP 429' })
  })
})
