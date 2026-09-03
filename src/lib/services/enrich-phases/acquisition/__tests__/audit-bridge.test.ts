import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { setAuditWriteSeam, type AuditRecord } from '@/lib/audit/emit'

import { invokeAudited, type AuditBridgeContext } from '../audit-bridge'
import { callModel } from '../../agents/runtime'

/**
 * `audit-bridge` is a re-export shim over `agents/runtime`. It survives because
 * `products/graph.ts` imports `invokeAudited` by name; the behaviour under it is
 * the runtime's single `callModel`.
 */
describe('audit-bridge', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('audit_bridge_is_the_runtime_call_model', () => {
    expect(invokeAudited).toBe(callModel)
  })

  it('audit_bridge_emits_ChatAuditEvent_with_usage_and_span', async () => {
    const records: AuditRecord[] = []
    setAuditWriteSeam(async (record) => {
      records.push(record)
      return null
    })

    const fakeModel = {
      invoke: vi.fn().mockResolvedValue({
        content: 'test response',
        usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      }),
    }

    const persistSpy = vi.fn().mockResolvedValue(undefined)
    const emitSpy = vi.fn()

    const ctx: AuditBridgeContext = {
      phase: 'products',
      jobId: 'job-1',
      target: { type: 'brand', id: 'brand-1' },
      _persistAuditEvent: persistSpy,
      _emitLangfuseGeneration: emitSpy,
    }

    await invokeAudited(
      fakeModel,
      [new SystemMessage('You are a planner.'), new HumanMessage('Plan the scrape.')],
      ctx,
    )

    const terminal = records.find((record) => record.status !== 'started')
    expect(terminal?.provider).toBe('openai')
    expect(terminal?.operation).toBe('chat_completions')
    expect(terminal?.subjectId).toBe('brand-1')
    expect(terminal?.jobId).toBe('job-1')
    expect(terminal?.promptTokens).toBe(100)
    expect(terminal?.completionTokens).toBe(50)

    expect(persistSpy).toHaveBeenCalledTimes(1)
    const [auditCtx, event, spanId] = persistSpy.mock.calls[0]!
    // The caller's phase is carried through — the shim adds no default.
    expect(auditCtx.phase).toBe('products')
    expect(spanId).toBe(terminal?.spanId)
    expect(event.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    })

    expect(emitSpy).toHaveBeenCalledTimes(1)
    expect(emitSpy.mock.calls[0]![1].provider).toBe('openai')
  })
})
