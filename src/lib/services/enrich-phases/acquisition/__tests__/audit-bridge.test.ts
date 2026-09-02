import { describe, expect, it, vi } from 'vitest'

import { invokeAudited, type AuditBridgeContext } from '../audit-bridge'

// Mock only the audit envelope (allowed — @/lib/audit is not under @/lib/services/)
vi.mock('@/lib/audit', () => ({
  auditedCall: vi.fn().mockImplementation((_spec: unknown, fn: (ctx: { summary: Record<string, unknown> }) => unknown) => fn({ summary: {} })),
}))

import { auditedCall } from '@/lib/audit'

describe('audit-bridge', () => {
  it('audit_bridge_emits_ChatAuditEvent_with_usage_and_span', async () => {
    const fakeResponse = {
      content: 'test response',
      usage_metadata: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      },
    }

    const fakeModel = {
      invoke: vi.fn().mockResolvedValue(fakeResponse),
    }

    const persistSpy = vi.fn().mockResolvedValue(undefined)
    const emitSpy = vi.fn()

    const ctx: AuditBridgeContext = {
      phase: 'acquisition',
      jobId: 'job-1',
      _persistAuditEvent: persistSpy,
      _emitLangfuseGeneration: emitSpy,
    }

    const messages = [
      { role: 'system' as const, content: 'You are a planner.' },
      { role: 'user' as const, content: 'Plan the scrape.' },
    ]

    await invokeAudited(fakeModel, messages, ctx)

    // auditedCall was called with acquisition spec
    const mockedAuditedCall = vi.mocked(auditedCall)
    expect(mockedAuditedCall).toHaveBeenCalledTimes(1)
    const spec = mockedAuditedCall.mock.calls[0]![0]
    expect(spec.provider).toBe('openai')
    expect(spec.operation).toBe('chat_completions')
    expect(spec.kind).toBe('external')
    expect(spec.spanId).toBeDefined()
    expect(typeof spec.spanId).toBe('string')

    // persistAuditEvent was called once with phase 'acquisition'
    expect(persistSpy).toHaveBeenCalledTimes(1)
    const [auditCtx, event, spanId] = persistSpy.mock.calls[0]!
    expect(auditCtx.phase).toBe('acquisition')
    expect(spanId).toBe(spec.spanId)
    expect(event.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    })

    // Langfuse generation emitted
    expect(emitSpy).toHaveBeenCalledTimes(1)
    const [lfCtx, lfEvent] = emitSpy.mock.calls[0]!
    expect(lfCtx.phase).toBe('acquisition')
    expect(lfEvent.provider).toBe('openai')
  })
})
