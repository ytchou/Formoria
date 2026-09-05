import type { ZodObject, ZodRawShape } from 'zod'

import { getLangfuse } from '@/lib/langfuse/client'
import {
  findQueueByName as findQueue,
  enqueueTrace as enqueue,
  listQueueScores,
} from './langfuse-runs'
import { adapterFor as defaultAdapterFor } from './phase-adapters'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DatasetItemLike = {
  id: string
  status: string
  input: unknown
  expectedOutput: unknown
  metadata?: unknown
}

type TraceBody = {
  name: string
  input: unknown
  metadata: Record<string, unknown>
  output: unknown
}

type VerdictScore = {
  id: string
  name: string
  value: number
  traceId: string
  comment?: string | null
  queueId?: string | null
}

export type EnqueueDeps = {
  getDataset: (name: string) => Promise<{ items: DatasetItemLike[] }>
  trace: (body: TraceBody) => { id: string }
  findQueueByName: (name: string) => Promise<string>
  enqueueTrace: (params: { queueId: string; traceId: string }) => Promise<void>
}

export type ApplyVerdictsDeps = {
  getDataset: (name: string) => Promise<{ items: DatasetItemLike[] }>
  listScores: (params: { name: string }) => Promise<VerdictScore[]>
  getTrace: (traceId: string) => Promise<{ metadata?: Record<string, unknown> }>
  createDatasetItem: (body: Record<string, unknown>) => Promise<unknown>
  adapterFor: (name: string) => { expectedSchema: ZodObject<ZodRawShape> }
}

// ---------------------------------------------------------------------------
// Verdict mapping
// ---------------------------------------------------------------------------

type Verdict = 'approve' | 'reject' | 'edit'

function verdictFromValue(value: number): Verdict {
  if (value === 1) return 'approve'
  if (value === 0) return 'reject'
  return 'edit'
}

// ---------------------------------------------------------------------------
// enqueueDataset
// ---------------------------------------------------------------------------

export async function enqueueDataset({
  dataset,
  queueName,
  deps,
}: {
  dataset: string
  queueName: string
  deps?: EnqueueDeps
}): Promise<{ enqueued: number; queueName: string }> {
  const getDatasetFn =
    deps?.getDataset ??
    (async (name: string) => {
      const client = getLangfuse()
      if (!client) throw new Error('Langfuse client not available')
      return client.getDataset(name)
    })

  const traceFn =
    deps?.trace ??
    ((body: TraceBody) => {
      const client = getLangfuse()
      if (!client) throw new Error('Langfuse client not available')
      return client.trace(body)
    })

  const findQueueFn =
    deps?.findQueueByName ?? ((name: string) => findQueue({ name }))

  const enqueueFn =
    deps?.enqueueTrace ?? ((params: { queueId: string; traceId: string }) => enqueue(params))

  const { items } = await getDatasetFn(dataset)
  const queueId = await findQueueFn(queueName)

  const activeItems = items.filter((item) => item.status === 'ACTIVE')

  for (const item of activeItems) {
    const trace = traceFn({
      name: `golden-review:${dataset}:${item.id}`,
      input: item.input,
      metadata: { datasetName: dataset, itemId: item.id },
      output: { expectedOutput: item.expectedOutput },
    })

    await enqueueFn({ queueId, traceId: trace.id })
  }

  return { enqueued: activeItems.length, queueName }
}

// ---------------------------------------------------------------------------
// applyVerdicts
// ---------------------------------------------------------------------------

type VerdictSummary = {
  approved: number
  rejected: number
  edited: number
  pending: number
}

export async function applyVerdicts({
  dataset,
  queueName: _queueName,
  approvedBy,
  deps,
}: {
  dataset: string
  queueName: string
  approvedBy: string
  deps?: ApplyVerdictsDeps
}): Promise<{ processed: number; pending: number; summary: VerdictSummary }> {
  const getDatasetFn =
    deps?.getDataset ??
    (async (name: string) => {
      const client = getLangfuse()
      if (!client) throw new Error('Langfuse client not available')
      return client.getDataset(name)
    })

  const listScoresFn =
    deps?.listScores ??
    (async (params: { name: string }) => {
      return listQueueScores(params) as unknown as Promise<VerdictScore[]>
    })

  const getTraceFn =
    deps?.getTrace ??
    (async (traceId: string) => {
      const client = getLangfuse()
      if (!client) throw new Error('Langfuse client not available')
      return client.api.traceGet(traceId)
    })

  const createDatasetItemFn =
    deps?.createDatasetItem ??
    (async (body: Record<string, unknown>) => {
      const client = getLangfuse()
      if (!client) throw new Error('Langfuse client not available')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return client.createDatasetItem(body as any)
    })

  const adapterForFn =
    deps?.adapterFor ??
    ((name: string) => defaultAdapterFor(name) as unknown as { expectedSchema: ZodObject<ZodRawShape> })

  const adapter = adapterForFn(dataset)
  const { items } = await getDatasetFn(dataset)
  const scores = await listScoresFn({ name: 'golden_verdict' })

  // Build traceId → itemId map (verdict lookup by trace metadata, not position)
  const traceToItem = new Map<string, string>()
  for (const score of scores) {
    const trace = await getTraceFn(score.traceId)
    const meta = trace.metadata as Record<string, unknown> | undefined
    const itemId = meta?.itemId as string | undefined
    if (itemId) {
      traceToItem.set(score.traceId, itemId)
    }
  }

  // Build itemId → verdict map
  const itemVerdicts = new Map<
    string,
    { score: VerdictScore; verdict: Verdict }
  >()
  for (const score of scores) {
    const itemId = traceToItem.get(score.traceId)
    if (itemId) {
      itemVerdicts.set(itemId, {
        score,
        verdict: verdictFromValue(score.value),
      })
    }
  }

  // Build item lookup
  const itemMap = new Map(items.map((item) => [item.id, item]))

  // Phase 1: Validate all verdicts before writing anything (all-or-nothing)
  type PreparedWrite = {
    itemId: string
    body: Record<string, unknown>
    verdict: Verdict
  }

  const writes: PreparedWrite[] = []
  const errors: string[] = []

  for (const [itemId, { score, verdict }] of itemVerdicts) {
    const item = itemMap.get(itemId)
    if (!item) continue

    const existingMeta =
      (item.metadata as Record<string, unknown> | null) ?? {}

    if (verdict === 'approve') {
      writes.push({
        itemId,
        verdict,
        body: {
          datasetName: dataset,
          id: itemId,
          input: item.input,
          expectedOutput: item.expectedOutput,
          metadata: {
            ...existingMeta,
            humanApproval: {
              status: 'approved',
              reviewedVia: { queueId: score.queueId, scoreId: score.id },
              approvedBy,
            },
          },
        },
      })
    } else if (verdict === 'reject') {
      writes.push({
        itemId,
        verdict,
        body: {
          datasetName: dataset,
          id: itemId,
          status: 'ARCHIVED',
          metadata: {
            ...existingMeta,
            humanApproval: { status: 'rejected' },
          },
        },
      })
    } else {
      // edit — comment must be valid JSON matching adapter.expectedSchema.partial()
      const comment = score.comment
      if (!comment) {
        errors.push(`item ${itemId}: edit verdict has no comment`)
        continue
      }

      let editFields: unknown
      try {
        editFields = JSON.parse(comment)
      } catch {
        errors.push(`item ${itemId}: edit comment is not valid JSON`)
        continue
      }

      const partialSchema = adapter.expectedSchema.partial()
      const validation = partialSchema.safeParse(editFields)
      if (!validation.success) {
        errors.push(
          `item ${itemId}: edit comment does not match expectedSchema`,
        )
        continue
      }

      const mergedExpected = {
        ...(item.expectedOutput as Record<string, unknown>),
        ...validation.data,
      }

      writes.push({
        itemId,
        verdict,
        body: {
          datasetName: dataset,
          id: itemId,
          input: item.input,
          expectedOutput: mergedExpected,
          metadata: {
            ...existingMeta,
            humanApproval: {
              status: 'approved',
              reviewedVia: { queueId: score.queueId, scoreId: score.id },
              approvedBy,
            },
          },
        },
      })
    }
  }

  // All-or-nothing: if any validation failed, abort before any writes
  if (errors.length > 0) {
    throw new Error(`Validation failed:\n${errors.join('\n')}`)
  }

  // Phase 2: Write all items
  for (const write of writes) {
    await createDatasetItemFn(write.body)
  }

  // Count pending (ACTIVE items with no verdict)
  const pending = items.filter(
    (item) => item.status === 'ACTIVE' && !itemVerdicts.has(item.id),
  ).length

  const summary: VerdictSummary = {
    approved: writes.filter((w) => w.verdict === 'approve').length,
    rejected: writes.filter((w) => w.verdict === 'reject').length,
    edited: writes.filter((w) => w.verdict === 'edit').length,
    pending,
  }

  return { processed: writes.length, pending, summary }
}
