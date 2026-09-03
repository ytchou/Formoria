import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { setAuditWriteSeam, type AuditRecord } from '@/lib/audit/emit'

import {
  callModel,
  extractJson,
  withSchema,
  withSignal,
  type AgentAuditContext,
} from '../runtime'

/**
 * The runtime uses the REAL `auditedCall` envelope: the audit write seam is the
 * observation point, so the test proves the row a production run would write
 * rather than the arguments of a mocked envelope. `vi.mock` of `@/lib/services/…`
 * is refused by `scripts/check-test-boundaries.mjs`, so `persistAuditEvent` and
 * `emitLangfuseGeneration` are injected through the context's test seams.
 */
function captureAuditRecords(): AuditRecord[] {
  const records: AuditRecord[] = []
  setAuditWriteSeam(async (record) => {
    records.push(record)
    return null
  })
  return records
}

function makeAudit(overrides: Partial<AgentAuditContext> = {}): AgentAuditContext {
  return {
    phase: 'acquire',
    jobId: 'job-1',
    target: { type: 'brand', id: 'brand-1' },
    modelName: 'gpt-test',
    ...overrides,
  }
}

const MESSAGES = [new SystemMessage('You are a planner.'), new HumanMessage('Plan the scrape.')]

describe('agents runtime — callModel', () => {
  beforeEach(() => {
    // Pricing reads `llm_model_prices` through the service client. Blanking the
    // credentials keeps the lookup in its own catch (costUsd null) instead of
    // reaching a real project from a unit test.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('runtime_callModel_prices_and_attributes_every_turn', async () => {
    const records = captureAuditRecords()
    const persist = vi.fn().mockResolvedValue(undefined)
    const emit = vi.fn()

    const model = {
      invoke: vi.fn().mockResolvedValue(
        new AIMessage({
          content: '{"ok":true}',
          usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        }),
      ),
    }

    const response = await callModel(
      model,
      MESSAGES,
      makeAudit({ _persistAuditEvent: persist, _emitLangfuseGeneration: emit }),
    )

    expect(response.content).toBe('{"ok":true}')

    // The envelope carries tokens, cost and attribution onto the audit row.
    const terminal = records.find((record) => record.status !== 'started')
    expect(terminal).toBeDefined()
    expect(terminal!.status).toBe('succeeded')
    expect(terminal!.promptTokens).toBe(100)
    expect(terminal!.completionTokens).toBe(50)
    expect(terminal).toHaveProperty('costUsd')
    expect(terminal!.subjectId).toBe('brand-1')
    expect(terminal!.jobId).toBe('job-1')
    expect(terminal!.provider).toBe('openai')
    expect(terminal!.operation).toBe('chat_completions')

    // brand_ai_results row carries the caller's phase — never a default.
    expect(persist).toHaveBeenCalledTimes(1)
    const [auditCtx, event, spanId] = persist.mock.calls[0]!
    expect(auditCtx.phase).toBe('acquire')
    expect(auditCtx.jobId).toBe('job-1')
    expect(auditCtx.target).toEqual({ type: 'brand', id: 'brand-1' })
    expect(event.ok).toBe(true)
    expect(event.model).toBe('gpt-test')
    expect(event.usage).toEqual({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 })
    expect(event.request.system).toBe('You are a planner.')
    expect(event.request.user).toBe('Plan the scrape.')
    expect(spanId).toBe(terminal!.spanId)

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]![0].phase).toBe('acquire')
  })

  it('runtime_callModel_persists_a_failed_event_when_the_model_throws', async () => {
    const records = captureAuditRecords()
    const persist = vi.fn().mockResolvedValue(undefined)
    const emit = vi.fn()

    const model = { invoke: vi.fn().mockRejectedValue(new Error('upstream 503')) }

    await expect(
      callModel(model, MESSAGES, makeAudit({ _persistAuditEvent: persist, _emitLangfuseGeneration: emit })),
    ).rejects.toThrow('upstream 503')

    // A failed turn still writes its row — the gap F15 records.
    expect(persist).toHaveBeenCalledTimes(1)
    const [auditCtx, event] = persist.mock.calls[0]!
    expect(auditCtx.phase).toBe('acquire')
    expect(event.ok).toBe(false)
    expect(event.error).toContain('upstream 503')

    const terminal = records.find((record) => record.status !== 'started')
    expect(terminal?.status).toBe('failed')
    expect(terminal?.subjectId).toBe('brand-1')
  })

  it('runtime_callModel_passes_the_abort_signal_to_the_model', async () => {
    captureAuditRecords()
    const controller = new AbortController()
    const model = { invoke: vi.fn().mockResolvedValue(new AIMessage({ content: 'ok' })) }

    await callModel(model, MESSAGES, makeAudit({ signal: controller.signal }))

    expect(model.invoke).toHaveBeenCalledTimes(1)
    expect(model.invoke.mock.calls[0]![1]).toMatchObject({ signal: controller.signal })
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
