import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { setAuditWriteSeam, type AuditRecord } from '@/lib/audit/emit'
import { resolveProfileModel } from '@/lib/constants/llm-models'
import type { ChatMessage } from '@/lib/services/openai-client'
import { toStrictJsonSchema } from '@/lib/services/_shared/zod-schema'

import {
  abnormalCompletion,
  abnormalDetail,
  abnormalErrorCode,
  AbnormalCompletionError,
  contentText,
  createAgentModel,
  extractJson,
  withSchema,
  withSignal,
} from '../runtime'

/**
 * The runtime uses the REAL audited client: `fetch` is the only stub, and the
 * `brand_ai_results` write is observed through the injected Supabase seam on the
 * audit context. `vi.mock` of `@/lib/services/…` or `@supabase/…` is refused by
 * `scripts/check-test-boundaries.mjs`, so nothing internal is mocked.
 */
type InsertedRow = Record<string, unknown>

function fakeSupabase(inserts: InsertedRow[]) {
  return {
    from(table: string) {
      if (table !== 'brand_ai_results') throw new Error(`Unexpected table ${table}`)
      return {
        insert: async (row: InsertedRow) => {
          inserts.push(row)
          return { error: null }
        },
      }
    },
  } as never
}

function captureAuditRecords(): AuditRecord[] {
  const records: AuditRecord[] = []
  setAuditWriteSeam(async (record) => {
    records.push(record)
    return null
  })
  return records
}

function okResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function chatBody(content: string) {
  return { choices: [{ message: { content } }] }
}

type FetchSpy = { mock: { calls: unknown[][] } }

function firstInit(fetchSpy: FetchSpy): RequestInit {
  return fetchSpy.mock.calls[0]![1] as RequestInit
}

function requestBody(fetchSpy: FetchSpy): Record<string, unknown> {
  return JSON.parse(firstInit(fetchSpy).body as string) as Record<string, unknown>
}

const MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'You are a planner.' },
  { role: 'user', content: 'Plan the scrape.' },
]

const TOOLS = [
  { name: 'fetch_page', description: 'Fetch a page', parameters: { type: 'object' } },
]

/** A products-repair reply shape, precomputed the way the products graph does. */
const REPAIR_SCHEMA = {
  name: 'curated_product_repair',
  schema: toStrictJsonSchema(
    z.object({
      products: z.array(
        z.object({ name_zh: z.string(), source_url: z.string(), product_description: z.string() }),
      ),
    }),
  ),
}

const REPAIRED_PRODUCT = {
  name_zh: '手工柴燒茶杯',
  source_url: 'https://www.yingge-pottery.com.tw/products/wood-fired-teacup',
  product_description: '鶯歌窯場以柴燒製成，杯面保留落灰的自然釉色。',
}

const TARGET = { type: 'brand' as const, id: '00000000-0000-4000-8000-000000000001' }

function audit(inserts: InsertedRow[]) {
  return {
    phase: 'products',
    jobId: 'job-1',
    target: TARGET,
    supabase: fakeSupabase(inserts),
  }
}

describe('agents runtime — createAgentModel', () => {
  beforeEach(() => {
    // Pricing reads `llm_model_prices` through the service client. Blanking the
    // credentials keeps the lookup in its own catch (costUsd null) instead of
    // reaching a real project from a unit test.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    vi.stubEnv('OPENAI_MODEL_OVERRIDE', '')
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    captureAuditRecords()
  })

  afterEach(() => {
    setAuditWriteSeam(null)
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('createAgentModel_invokes_chat_with_profile_params_and_messages', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse(chatBody('{"ok":true}')))
    vi.stubGlobal('fetch', fetchSpy)

    const model = await createAgentModel('products_agent', audit([]))
    const response = await model.invoke(MESSAGES)

    expect(response.content).toBe('{"ok":true}')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const body = requestBody(fetchSpy)
    expect(body.model).toBe(resolveProfileModel('products_agent'))
    expect(body.temperature).toBe(0.1)
    expect(body.reasoning_effort).toBe('none')
    // DEV-1864 R4: a tool-less turn without a schema is plain text — the
    // runtime has no json_object mode of its own.
    expect(body.response_format).toBeUndefined()
    expect(body.messages).toEqual(MESSAGES)
    expect(body.tools).toBeUndefined()
  })

  it('createAgentModel_omits_response_format_when_tools_are_passed', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse(chatBody('plan')))
    vi.stubGlobal('fetch', fetchSpy)

    const model = await createAgentModel('acquisition', audit([]))
    await model.invoke(MESSAGES, { tools: TOOLS })

    const body = requestBody(fetchSpy)
    expect(body.response_format).toBeUndefined()
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'fetch_page',
          description: 'Fetch a page',
          parameters: { type: 'object' },
        },
      },
    ])
  })

  // DEV-1864 F2/R-SCHEMA. A tool-less turn with a schema is enforced by the API
  // (strict json_schema), not by a prose "output only JSON" instruction. The
  // caller precomputes the schema; the runtime forwards it untouched.
  it('createAgentModel_sends_the_precomputed_schema_as_strict_json_schema_without_tools', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(okResponse(chatBody(JSON.stringify({ products: [REPAIRED_PRODUCT] }))))
    vi.stubGlobal('fetch', fetchSpy)

    const model = await createAgentModel('products_agent', audit([]))
    const response = await model.invoke(MESSAGES, { schema: REPAIR_SCHEMA })

    const body = requestBody(fetchSpy)
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'curated_product_repair', strict: true, schema: REPAIR_SCHEMA.schema },
    })
    expect(JSON.parse(contentText(response))).toEqual({ products: [REPAIRED_PRODUCT] })
  })

  it('createAgentModel_sends_no_response_format_when_schema_and_tools_are_both_passed', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse(chatBody('plan')))
    vi.stubGlobal('fetch', fetchSpy)

    const model = await createAgentModel('acquisition', audit([]))
    await model.invoke(MESSAGES, { tools: TOOLS, schema: REPAIR_SCHEMA })

    const body = requestBody(fetchSpy)
    expect(body.response_format).toBeUndefined()
    expect(body.tools).toBeDefined()
  })

  it('createAgentModel_writes_an_audit_row_with_usage_and_cost', async () => {
    const records = captureAuditRecords()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          ...chatBody('{"ok":true}'),
          usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
        }),
      ),
    )

    const inserts: InsertedRow[] = []
    const model = await createAgentModel('products_agent', audit(inserts))
    await model.invoke(MESSAGES)

    expect(inserts).toHaveLength(1)
    const row = inserts[0]!
    expect(row.phase).toBe('products')
    expect(row.job_id).toBe('job-1')
    expect(row.brand_id).toBe(TARGET.id)
    expect(row.raw_response).toMatchObject({
      provider: 'openai',
      ok: true,
      status: 200,
      usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
    })

    // The row is linked to the envelope's span, so cost and attribution join up.
    const terminal = records.find((record) => record.status !== 'started')
    expect(terminal?.status).toBe('succeeded')
    expect(terminal?.subjectId).toBe(TARGET.id)
    expect(terminal?.jobId).toBe('job-1')
    expect(row.audit_span_id).toBe(terminal?.spanId)
  })

  it('createAgentModel_writes_a_failed_row_and_throws_on_http_error', async () => {
    vi.stubGlobal(
      'fetch',
      // A fresh Response per attempt: the client retries a 5xx, and a Response
      // body can only be consumed once.
      vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ error: { message: 'server exploded' } }), {
            status: 500,
          }),
      ),
    )

    const inserts: InsertedRow[] = []
    const model = await createAgentModel('products_agent', audit(inserts))

    await expect(model.invoke(MESSAGES)).rejects.toThrow(/500/)

    // A failed turn still writes its row — the gap DEV-1644 F15 recorded. The
    // client retries a 5xx, so every attempt writes one failed row.
    expect(inserts.length).toBeGreaterThanOrEqual(1)
    for (const row of inserts) {
      expect(row.phase).toBe('products')
      expect(row.raw_response).toMatchObject({ ok: false, status: 500 })
    }
  })

  it('createAgentModel_passes_the_signal_through', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse(chatBody('ok')))
    vi.stubGlobal('fetch', fetchSpy)

    const controller = new AbortController()
    const model = await createAgentModel('products_agent', audit([]))
    await model.invoke(MESSAGES, { signal: controller.signal })

    const init = firstInit(fetchSpy)
    expect(init.signal).toBeDefined()
    expect(init.signal!.aborted).toBe(false)
    controller.abort()
    expect(init.signal!.aborted).toBe(true)
  })

  it('createAgentModel_maps_tool_calls_and_usage_to_camelCase', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'fetch_page', arguments: '{"url":"https://a.test"}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        }),
      ),
    )

    const model = await createAgentModel('acquisition', audit([]))
    const response = await model.invoke(MESSAGES, { tools: TOOLS })

    expect(response.content).toBeNull()
    expect(response.toolCalls?.[0]).toMatchObject({
      id: 'call_1',
      name: 'fetch_page',
      args: { url: 'https://a.test' },
    })
    expect(response.usage?.prompt_tokens).toBe(12)
    expect(contentText(response)).toBe('')
  })

  // DEV-1866: a refusal or a truncated reply must reach the agent graph, so it
  // can stop instead of spending a reparse turn on a payload that cannot parse.
  it('createAgentModel_passes_finish_reason_and_refusal_through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          choices: [{ message: { content: null, refusal: 'no' }, finish_reason: 'length' }],
        }),
      ),
    )

    const model = await createAgentModel('products_agent', audit([]))
    const response = await model.invoke(MESSAGES)

    expect(response.finishReason).toBe('length')
    expect(response.refusal).toBe('no')
  })
})

describe('agents runtime — helpers', () => {
  it('extractJson_unwraps_a_fenced_payload', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJson('  {"a":1}  ')).toBe('{"a":1}')
  })

  it('withSchema_inlines_the_strict_json_schema_and_trailer', () => {
    const schema = z.object({ url: z.string() }).strict()
    const prompt = withSchema('Base prompt.', 'Thing', schema)

    expect(prompt).toContain('Base prompt.')
    expect(prompt).toContain('## Thing JSON Schema')
    expect(prompt).toContain('"additionalProperties":false')
    expect(prompt).toContain('Output only a JSON object')
  })

  it('withSchema_replaces_the_default_trailer_when_one_is_passed', () => {
    const schema = z
      .object({ url: z.string(), fetch: z.enum(['static', 'render', 'skip']) })
      .strict()
    const trailer = 'Submit the plan by calling submit_plan; its arguments must match this schema.'
    const prompt = withSchema('Plan evidence acquisition for 鶯歌陶瓷.', 'AcquisitionPlan', schema, trailer)

    expect(prompt).toContain('## AcquisitionPlan JSON Schema')
    expect(prompt.endsWith(trailer)).toBe(true)
    expect(prompt).not.toContain('Output only a JSON object')
  })

  it('withSignal_combines_signals_and_returns_undefined_when_empty', () => {
    expect(withSignal()).toBeUndefined()
    expect(withSignal(undefined, undefined)).toBeUndefined()

    const controller = new AbortController()
    expect(withSignal(controller.signal)).toBe(controller.signal)

    const other = new AbortController()
    const combined = withSignal(controller.signal, other.signal)
    expect(combined).toBeDefined()
    expect(combined!.aborted).toBe(false)
    other.abort()
    expect(combined!.aborted).toBe(true)
  })
})

// withNodeSpan tests moved to src/lib/tracing/__tests__/span.test.ts

describe('agents runtime — abnormal completion', () => {
  it('abnormal_completion_classifies_refused_truncated_filtered', () => {
    expect(abnormalCompletion({ refusal: 'I cannot', finishReason: 'stop' })).toBe('refused')
    expect(abnormalCompletion({ refusal: 'I cannot', finishReason: 'length' })).toBe('refused')
    expect(abnormalCompletion({ finishReason: 'length' })).toBe('truncated')
    expect(abnormalCompletion({ finishReason: 'content_filter' })).toBe('filtered')
  })

  it('abnormal_completion_is_null_for_stop_and_tool_calls', () => {
    expect(abnormalCompletion({ finishReason: 'stop' })).toBeNull()
    expect(abnormalCompletion({ finishReason: 'tool_calls' })).toBeNull()
    expect(abnormalCompletion({})).toBeNull()
    expect(abnormalCompletion({ finishReason: null, refusal: null })).toBeNull()
    expect(abnormalCompletion({ refusal: '' })).toBeNull()
  })

  it('abnormal_detail_truncates_refusal_to_200_chars', () => {
    const refusal = 'x'.repeat(250)
    expect(abnormalDetail('refused', { refusal })).toBe(`refusal=${'x'.repeat(200)}`)
    expect(abnormalDetail('truncated', { finishReason: 'length' })).toBe('finish_reason=length')
    expect(abnormalDetail('filtered', { finishReason: 'content_filter' })).toBe(
      'finish_reason=content_filter',
    )
    expect(abnormalDetail('truncated', {})).toBe('finish_reason=none')
  })

  it('abnormal_error_code_maps_each_kind', () => {
    expect(abnormalErrorCode('refused')).toBe('model_refused')
    expect(abnormalErrorCode('truncated')).toBe('model_truncated')
    expect(abnormalErrorCode('filtered')).toBe('model_filtered')
  })

  it('abnormal_completion_error_carries_kind_and_detail', () => {
    const error = new AbnormalCompletionError('filtered', 'finish_reason=content_filter')

    expect(error).toBeInstanceOf(AbnormalCompletionError)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AbnormalCompletionError')
    expect(error.kind).toBe('filtered')
    expect(error.detail).toBe('finish_reason=content_filter')
    expect(error.message).toBe('model reply filtered: finish_reason=content_filter')
  })
})
