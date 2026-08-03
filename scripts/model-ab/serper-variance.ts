/**
 * Measures how repeatable serper.dev is for the queries this pipeline sends.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/model-ab/serper-variance.ts
 *
 * Runs the same query N times back to back against both endpoints the pipeline
 * uses and reports set overlap between consecutive calls. Back-to-back matters:
 * it separates "Google's index moved" from "this endpoint is simply not
 * deterministic", which need different fixes.
 */
const QUERIES = [
  { label: 'entadar', images: 'site:entadar.com Entadar 海漂計畫', search: 'Entadar 海漂計畫' },
  { label: 'yates', images: 'site:yatesvacuum.com Yates 亞堤斯', search: 'Yates 亞堤斯' },
]
const REPEATS = 3

async function serper(endpoint: 'images' | 'search', q: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.SERPER_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, num: 10, gl: 'tw', hl: 'zh-TW', autocorrect: false, ...extra }),
  })
  if (!res.ok) throw new Error(`${endpoint} ${res.status}`)
  const json = (await res.json()) as Record<string, unknown>
  if (endpoint === 'images') {
    return ((json.images ?? []) as Array<{ imageUrl: string }>).map((i) => i.imageUrl)
  }
  return ((json.organic ?? []) as Array<{ link: string }>).map((o) => o.link)
}

const jaccard = (a: string[], b: string[]): number => {
  const sa = new Set(a)
  const sb = new Set(b)
  const inter = [...sa].filter((x) => sb.has(x)).length
  const union = new Set([...sa, ...sb]).size
  return union === 0 ? 1 : inter / union
}

async function main(): Promise<void> {
  for (const q of QUERIES) {
    for (const endpoint of ['images', 'search'] as const) {
      const query = endpoint === 'images' ? q.images : q.search
      // The image call carries the size filter the pipeline actually sends.
      const extra = endpoint === 'images' ? { tbs: 'isz:lt,islt:vga' } : {}
      const runs: string[][] = []
      for (let i = 0; i < REPEATS; i++) runs.push(await serper(endpoint, query, extra))

      const overlaps: string[] = []
      for (let i = 1; i < runs.length; i++) {
        overlaps.push(`${(jaccard(runs[0]!, runs[i]!) * 100).toFixed(0)}%`)
      }
      const orderStable = runs.every((r) => r.join('|') === runs[0]!.join('|'))
      const counts = runs.map((r) => r.length).join('/')
      console.log(
        `${q.label.padEnd(10)} ${endpoint.padEnd(7)} n=${counts.padEnd(9)} ` +
          `overlap vs run1: ${overlaps.join(', ').padEnd(12)} order identical: ${orderStable}`
      )
    }
  }
}

void main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})

export {}
