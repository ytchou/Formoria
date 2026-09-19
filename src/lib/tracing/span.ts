/**
 * Langfuse node-span wrapper, extracted from the agent runtime so that any
 * service can trace a unit of work without importing the LLM agent stack.
 *
 * Dependencies: `@/lib/audit` only (audit context + AsyncLocalStorage).
 * Must NOT import from `openai-client`, `llm-audit`, or `llm-models`.
 */

import { getAuditContext, runWithAuditContext } from '@/lib/audit'

/**
 * Wraps a graph node (or any scoped unit of work) in a Langfuse span.
 *
 * The span replaces `langfuseTrace` in the audit context for the duration of
 * `fn`, so every LLM generation and external-call span created inside nests
 * under this span instead of the trace root.
 *
 * No-ops when Langfuse is unconfigured (null trace). Must never throw from
 * Langfuse operations — all errors are swallowed.
 */
export async function withNodeSpan<T>(
  name: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  let trace: unknown
  try {
    trace = getAuditContext().langfuseTrace
  } catch {
    return fn()
  }
  if (!trace) return fn()

  let span: { end: () => void }
  try {
    span = (trace as { span: (input: Record<string, unknown>) => { end: () => void } }).span({
      name,
    })
  } catch {
    return fn()
  }

  try {
    return await runWithAuditContext({ langfuseTrace: span }, () => fn())
  } finally {
    try {
      span.end()
    } catch {
      // Langfuse errors must never block production
    }
  }
}
