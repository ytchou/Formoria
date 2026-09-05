import { getLangfuse } from '@/lib/langfuse/client'

// ---------------------------------------------------------------------------
// Naming conventions
// ---------------------------------------------------------------------------

export function runName(dataset: string, arm: string, iso: string): string {
  return `${dataset}:${arm}:${iso}`
}

export function traceName(dataset: string, arm: string, itemId: string): string {
  return `eval:${dataset}:${arm}:${itemId}`
}

// ---------------------------------------------------------------------------
// Score writing
// ---------------------------------------------------------------------------

type ScoreEntry = { name: string; value: number }

type ScoreFn = (params: {
  traceId: string
  name: string
  value: number
}) => void

/**
 * Writes one Langfuse score per evaluator on the given trace.
 * `scoreFn` is injected for testability; defaults to `getLangfuse().score()`.
 */
export async function writeItemScores({
  traceId,
  scores,
  scoreFn,
}: {
  traceId: string
  scores: ScoreEntry[]
  scoreFn?: ScoreFn
}): Promise<void> {
  const fn = scoreFn ?? ((params) => {
    const client = getLangfuse()
    if (client) client.score(params)
  })

  for (const { name, value } of scores) {
    fn({ traceId, name, value })
  }
}

// ---------------------------------------------------------------------------
// Dataset item linking
// ---------------------------------------------------------------------------

type LinkableItem = {
  link: (trace: unknown, runName: string, opts?: { metadata?: unknown }) => void
}

/**
 * Links a dataset item to its trace and run.
 */
export function linkItem({
  item,
  trace,
  runName: rn,
  metadata,
}: {
  item: LinkableItem
  trace: unknown
  runName: string
  metadata?: unknown
  linkFn?: never
}): void {
  item.link(trace, rn, metadata !== undefined ? { metadata } : undefined)
}

// ---------------------------------------------------------------------------
// Annotation queue helpers
// ---------------------------------------------------------------------------

type QueueEntry = { id: string; name: string }
type ListQueuesResult = { data: QueueEntry[] }
type ListQueuesFn = () => Promise<ListQueuesResult>

/**
 * Finds an annotation queue by name.
 * Returns the queue id, or throws listing available names.
 */
export async function findQueueByName({
  name,
  listFn,
}: {
  name: string
  listFn?: ListQueuesFn
}): Promise<string> {
  const fn = listFn ?? (async () => {
    const client = getLangfuse()
    if (!client) throw new Error('Langfuse client not available')
    return client.api.annotationQueuesListQueues({})
  })

  const result = await fn()
  const queue = result.data.find((q) => q.name === name)
  if (queue) return queue.id

  const available = result.data.map((q) => q.name).join(', ')
  throw new Error(
    `Annotation queue "${name}" not found. Available: ${available}`,
  )
}

// ---------------------------------------------------------------------------
// Enqueue trace
// ---------------------------------------------------------------------------

type CreateQueueItemFn = (
  queueId: string,
  body: { objectId: string; objectType: 'TRACE' },
) => Promise<unknown>

/**
 * Enqueues a trace into an annotation queue for human review.
 */
export async function enqueueTrace({
  queueId,
  traceId,
  createFn,
}: {
  queueId: string
  traceId: string
  createFn?: CreateQueueItemFn
}): Promise<void> {
  const fn = createFn ?? (async (qId, body) => {
    const client = getLangfuse()
    if (!client) throw new Error('Langfuse client not available')
    return client.api.annotationQueuesCreateQueueItem(qId, body)
  })

  await fn(queueId, { objectId: traceId, objectType: 'TRACE' })
}

// ---------------------------------------------------------------------------
// List queue scores (paginated)
// ---------------------------------------------------------------------------

type ScoreRecord = { name: string; value: number; traceId: string }
type ScoresPage = { data: ScoreRecord[]; meta: { totalPages: number; page: number } }
type ListScoresFn = (query: { name: string; page: number }) => Promise<ScoresPage>

/**
 * Lists all scores matching a given name, paginating through all pages.
 */
export async function listQueueScores({
  name,
  listFn,
}: {
  name: string
  listFn?: ListScoresFn
}): Promise<ScoreRecord[]> {
  const fn = listFn ?? (async (query) => {
    const client = getLangfuse()
    if (!client) throw new Error('Langfuse client not available')
    return client.api.scoreV2Get(query) as unknown as ScoresPage
  })

  const allScores: ScoreRecord[] = []
  let page = 1
  let totalPages = 1

  do {
    const result = await fn({ name, page })
    allScores.push(...result.data.filter((s) => s.name === name))
    totalPages = result.meta.totalPages
    page++
  } while (page <= totalPages)

  return allScores
}
