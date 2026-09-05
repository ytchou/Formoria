import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { setAuditWriteSeam, type AuditRecord } from '@/lib/audit/emit'
import { resolveProfileModel } from '@/lib/constants/llm-models'
import type { ChatMessage } from '@/lib/services/openai-client'

import {
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

    const model = await createAgentModel('products_agent', audit([]), { jsonObject: true })
    const response = await model.invoke(MESSAGES)

    expect(response.content).toBe('{"ok":true}')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const body = requestBody(fetchSpy)
    expect(body.model).toBe(resolveProfileModel('products_agent'))
    expect(body.temperature).toBe(0.1)
    expect(body.reasoning_effort).toBe('none')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages).toEqual(MESSAGES)
    expect(body.tools).toBeUndefined()
  })

  it('createAgentModel_omits_json_mode_when_tools_are_passed', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse(chatBody('plan')))
    vi.stubGlobal('fetch', fetchSpy)

    const model = await createAgentModel('acquisition', audit([]), { jsonObject: true })
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
    const model = await createAgentModel('products_agent', audit(inserts), { jsonObject: true })
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
    const model = await createAgentModel('products_agent', audit(inserts), { jsonObject: true })

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
