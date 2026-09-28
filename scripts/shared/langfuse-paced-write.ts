import type { RetryPolicy } from '@/lib/retry'

/**
 * Fixed pacing under Langfuse's 100 writes/min: 700ms per call is ~86/min, so a
 * 156-item seed takes ~2 minutes. Ceiling: one serial writer at the default rate
 * limit; read the limit from 429 headers if the dataset grows past ~1k items.
 */
export const LANGFUSE_PACE_MS = 700
/** 1 attempt + 3 retries, waiting ~2s/4s/8s (withRetry adds up to 100% jitter, capped at 8s). */
export const LANGFUSE_RETRY_POLICY: RetryPolicy = { attempts: 4, baseMs: 2_000, factor: 2, capMs: 8_000 }

export const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The HTTP status on a rejection from the SDK's `client.api.*` client, which throws its Response. */
export function httpStatusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

export type PacedWriterOptions<B extends { id: string }> = {
  /** Upserts one dataset item; the SDK resolves a 429 instead of rejecting, so the returned id is the only confirmation. */
  createItem: (body: B) => Promise<unknown>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  minIntervalMs?: number
  retries?: number
  backoffMs?: number
}

/**
 * The paced, 429-retrying Langfuse call path: calls run at least
 * `minIntervalMs` apart; a 429, or a call that resolves `undefined`, is
 * retried with exponential backoff up to `retries` attempts. Other errors
 * propagate.
 */
export function pacedLangfuseWriter<B extends { id: string }>({
  createItem,
  sleep = realSleep,
  now = Date.now,
  minIntervalMs = LANGFUSE_PACE_MS,
  retries = 4,
  backoffMs = 10_000,
}: PacedWriterOptions<B>) {
  let lastCall: number | null = null
  const paced = async <T>(call: () => Promise<T>): Promise<T> => {
    if (lastCall !== null) {
      const wait = lastCall + minIntervalMs - now()
      if (wait > 0) await sleep(wait)
    }
    lastCall = now()
    return call()
  }
  /** Retries a 429; `undefined` from `call` also means "retry". Other errors propagate. */
  const withRetry = async <T>(call: () => Promise<T | undefined>): Promise<T | undefined> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await paced(call)
        if (result !== undefined) return result
      } catch (error) {
        if (httpStatusOf(error) !== 429) throw error
      }
      if (attempt >= retries) return undefined
      await sleep(backoffMs * 2 ** (attempt - 1))
    }
  }
  const orThrow = <T>(value: T | undefined, what: string): T => {
    if (value === undefined) throw new Error(`[golden] ${what}: still rate-limited after ${retries} attempts`)
    return value
  }

  /** Creates `body` through the paced, retried path; true only when Langfuse confirms the id. */
  const confirmedWrite = async (body: B): Promise<boolean> =>
    (await withRetry(async () => {
      const response = (await createItem(body)) as { id?: unknown } | null
      return response?.id === body.id ? true : undefined
    })) === true
  return { paced, withRetry, orThrow, confirmedWrite }
}
