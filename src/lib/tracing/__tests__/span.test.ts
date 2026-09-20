import { describe, expect, it, vi } from 'vitest'
import { getAuditContext, runWithAuditContext } from '@/lib/audit'

import { withNodeSpan } from '../span'

describe('withNodeSpan', () => {
  it('withNodeSpan_wraps_fn_in_langfuse_span', async () => {
    const childSpan = { end: vi.fn(), span: vi.fn(), generation: vi.fn() }
    const mockSpan = vi.fn().mockReturnValue(childSpan)
    const langfuseTrace = { span: mockSpan, generation: vi.fn() }

    let innerTrace: unknown = null
    const result = await runWithAuditContext({ langfuseTrace }, () =>
      withNodeSpan('acquisition/gather', async () => {
        innerTrace = getAuditContext().langfuseTrace
        return 'done'
      }),
    )

    expect(result).toBe('done')
    expect(mockSpan).toHaveBeenCalledOnce()
    expect(mockSpan).toHaveBeenCalledWith({ name: 'acquisition/gather' })
    expect(childSpan.end).toHaveBeenCalledOnce()
    // Inner code sees the child span as its langfuseTrace
    expect(innerTrace).toBe(childSpan)
  })

  it('withNodeSpan_returns_fn_result_without_langfuse', async () => {
    // No langfuseTrace in context — pass-through
    const result = await runWithAuditContext({ correlationId: 'test' }, () =>
      withNodeSpan('acquisition/gather', async () => 'no-trace'),
    )

    expect(result).toBe('no-trace')
  })

  it('withNodeSpan_propagates_errors', async () => {
    const childSpan = { end: vi.fn(), span: vi.fn() }
    const langfuseTrace = { span: vi.fn().mockReturnValue(childSpan) }

    await expect(
      runWithAuditContext({ langfuseTrace }, () =>
        withNodeSpan('editorial/faq', async () => {
          throw new Error('boom')
        }),
      ),
    ).rejects.toThrow('boom')

    // Span is still ended even on error
    expect(childSpan.end).toHaveBeenCalledOnce()
  })

  it('swallows_span_creation_errors', async () => {
    const langfuseTrace = {
      span: vi.fn().mockImplementation(() => {
        throw new Error('Langfuse down')
      }),
    }

    const result = await runWithAuditContext({ langfuseTrace }, () =>
      withNodeSpan('acquisition/plan', async () => 'ok'),
    )

    expect(result).toBe('ok')
  })
})
