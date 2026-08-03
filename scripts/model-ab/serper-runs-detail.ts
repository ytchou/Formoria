/**
 * Dumps the raw /search results for each brand across K runs, so a human can
 * judge which URLs are signal and which are churn before we pick a filter.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/model-ab/serper-runs-detail.ts
 *
 * Shows, per URL: which runs returned it and at what rank, plus the title and
 * snippet — because the snippet is what actually reaches the description
 * prompt, and a URL that looks irrelevant can still carry a useful snippet
 * (and vice versa).
 */
const BRANDS = [
  { slug: 'entadar', query: 'Entadar 海漂計畫', own: ['entadar.com'] },
  { slug: 'heyyou-moment', query: '日句時刻所 Heyyou Moment', own: ['heyyoumoment.com'] },
  { slug: 'yates', query: 'Yates 亞堤斯', own: ['yatesvacuum.com'] },
]
const RUNS = 3

import { stripTrackingParams, isGoogleUrl } from '@/lib/services/enrich-phases/scraper/search'

type Organic = { link: string; title?: string; snippet?: string }

async function search(q: string): Promise<Organic[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.SERPER_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, num: 10, gl: 'tw', hl: 'zh-TW', autocorrect: false }),
  })
  if (!res.ok) throw new Error(`search ${res.status}`)
  const organic = ((await res.json()) as { organic?: Organic[] }).organic ?? []
  // Apply exactly what production applies in parseBrandSearchResults, so this
  // dump shows the URLs the pipeline really works with — not the raw links,
  // whose per-request `srsltid` nonce makes stable results look like churn.
  return organic
    .map((o) => ({ ...o, link: stripTrackingParams(o.link) }))
    .filter((o) => !isGoogleUrl(o.link))
}

const host = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return '?'
  }
}

const SOCIAL = ['instagram.com', 'facebook.com', 'threads.net', 'threads.com', 'youtube.com']
const MARKET = ['pinkoi.com', 'shopee.tw', 'momoshop.com.tw', 'books.com.tw', 'ruten.com.tw', 'shopline.tw']

function kind(u: string, own: string[]): string {
  const h = host(u)
  if (own.some((o) => h.endsWith(o))) return 'OWN'
  if (SOCIAL.some((s) => h.endsWith(s))) return 'social'
  if (MARKET.some((s) => h.endsWith(s))) return 'market'
  return 'other'
}

async function main(): Promise<void> {
  for (const brand of BRANDS) {
    const runs: Organic[][] = []
    for (let i = 0; i < RUNS; i++) runs.push(await search(brand.query))

    // rank per run, 1-indexed; undefined when absent from that run
    const ranks = new Map<string, (number | undefined)[]>()
    const meta = new Map<string, Organic>()
    for (const [ri, run] of runs.entries()) {
      for (const [i, o] of run.entries()) {
        const arr = ranks.get(o.link) ?? new Array(RUNS).fill(undefined)
        arr[ri] = i + 1
        ranks.set(o.link, arr)
        if (!meta.has(o.link)) meta.set(o.link, o)
      }
    }

    const rows = [...ranks.entries()].sort((a, b) => {
      const seenA = a[1].filter(Boolean).length
      const seenB = b[1].filter(Boolean).length
      if (seenA !== seenB) return seenB - seenA
      const minA = Math.min(...a[1].map((r) => r ?? 99))
      const minB = Math.min(...b[1].map((r) => r ?? 99))
      return minA - minB
    })

    console.log('\n' + '='.repeat(100))
    console.log(`${brand.slug}   query: ${brand.query}   (run sizes: ${runs.map((r) => r.length).join(', ')})`)
    console.log('='.repeat(100))
    console.log('seen  r1 r2 r3  kind    host / title')
    console.log('-'.repeat(100))
    for (const [link, r] of rows) {
      const seen = r.filter(Boolean).length
      const mark = seen === RUNS ? '###' : seen === 2 ? '## ' : '#  '
      const cells = r.map((x) => (x === undefined ? ' .' : String(x).padStart(2))).join(' ')
      const m = meta.get(link)!
      console.log(`${mark}   ${cells}  ${kind(link, brand.own).padEnd(7)} ${host(link)}`)
      console.log(`                        ${(m.title ?? '').slice(0, 76)}`)
      console.log(`                        ${(m.snippet ?? '').replace(/\s+/g, ' ').slice(0, 76)}`)
    }
    const keep = rows.filter(([, r]) => r.filter(Boolean).length >= 2).length
    console.log('-'.repeat(100))
    console.log(`union ${rows.length}   ->  kept by ">=2 of 3" filter: ${keep}   dropped: ${rows.length - keep}`)
  }
}

void main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})

export {}
