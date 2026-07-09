import { config } from 'dotenv'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

config({ path: resolve(import.meta.dirname ?? '.', '../../.env.local') })

// ---------------------------------------------------------------------------
// Golden 10 brands
// ---------------------------------------------------------------------------

type GoldenBrand = {
  slug: string
  name: string
  productType: string
  productTypeZh: string
  difficulty: string
}

const GOLDEN_BRANDS: GoldenBrand[] = [
  { slug: 'escura-x', name: 'ESCURA', productType: 'fashion', productTypeZh: '服飾鞋履', difficulty: 'easy' },
  { slug: 'sobdeall', name: '沙伯迪澳 SOBDEALL', productType: 'bags-accessories', productTypeZh: '包袋配件', difficulty: 'easy' },
  { slug: 'farmy-life', name: '日日好田 Farmy Life', productType: 'food-drink', productTypeZh: '食品飲料', difficulty: 'easy' },
  { slug: 'mooni', name: '沐澧 Mooni', productType: 'beauty', productTypeZh: '美妝保養', difficulty: 'medium' },
  { slug: 'evies-drawing-daily', name: "Evie's Drawing Daily", productType: 'crafts', productTypeZh: '工藝文創', difficulty: 'hard' },
  { slug: 'qmat-設計館', name: 'QMAT', productType: 'outdoor', productTypeZh: '戶外運動保健', difficulty: 'medium' },
  { slug: 'warmwood-living', name: '暖木家居 Warmwood Living', productType: 'home', productTypeZh: '居家生活', difficulty: 'medium' },
  { slug: 'lianne-baby', name: 'Lianne Baby 梨安', productType: 'kids-pets', productTypeZh: '母嬰寵物', difficulty: 'medium' },
  { slug: '1935', name: '鹿苑茶莊 1935', productType: 'food-drink', productTypeZh: '食品飲料', difficulty: 'medium' },
  { slug: 'clm', name: 'CLM', productType: 'unknown', productTypeZh: '', difficulty: 'hard' },
]

// ---------------------------------------------------------------------------
// Query variants
// ---------------------------------------------------------------------------

type QueryVariant = {
  id: string
  label: string
  build: (brand: GoldenBrand) => string
}

const VARIANTS: QueryVariant[] = [
  {
    id: 'A',
    label: 'Broad Discovery',
    build: (b) => `${b.name} 台灣`,
  },
  {
    id: 'B',
    label: 'Precision + Noise Filter',
    build: (b) => {
      const typeSegment = b.productTypeZh ? ` ${b.productTypeZh}` : ''
      return `"${b.name}"${typeSegment} 品牌 -徵才 -104 -人力`
    },
  },
  {
    id: 'C',
    label: 'Third-Party Content Bias',
    build: (b) => `${b.name} 品牌 介紹 評價 推薦`,
  },
]

// ---------------------------------------------------------------------------
// Serper SERP call
// ---------------------------------------------------------------------------

const SERPER_ENDPOINT = 'https://google.serper.dev/search'
const TIMEOUT_MS = 60_000

type SerperOrganicResult = {
  title: string
  link: string
  snippet?: string
  position: number
}

function isGoogleUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes('google.com')
  } catch {
    return false
  }
}

function stripTracking(url: string): string {
  try {
    const u = new URL(url)
    u.searchParams.delete('srsltid')
    return u.toString()
  } catch {
    return url
  }
}

async function fetchSerp(
  query: string,
  apiKey: string,
): Promise<SerperOrganicResult[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 10, gl: 'tw', hl: 'zh-TW' }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const msg = `SERP API error: ${res.status} ${res.statusText}`
      if (res.status === 402) throw new Error(`${msg} — Serper credits exhausted`)
      if (res.status === 403) throw new Error(`${msg} — Invalid SERPER_API_KEY`)
      console.error(`  ${msg}`)
      return []
    }

    const data = await res.json() as { organic?: SerperOrganicResult[] }
    return data.organic ?? []
  } catch (err) {
    console.error(`  SERP fetch failed: ${err instanceof Error ? err.message : err}`)
    return []
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Parse SERP results
// ---------------------------------------------------------------------------

type ParsedResult = {
  urls: string[]
  snippets: Array<{ title: string; description: string; url: string }>
  rawCount: number
  errorCount: number
}

function parseEntries(organicResults: SerperOrganicResult[]): ParsedResult {
  const urls = new Set<string>()
  const snippets: ParsedResult['snippets'] = []

  for (const r of organicResults) {
    if (typeof r.link === 'string' && !isGoogleUrl(r.link)) {
      urls.add(stripTracking(r.link))
    }
    snippets.push({
      title: r.title?.trim() ?? '',
      description: `${r.title?.trim() ?? ''} — ${r.snippet?.trim() ?? ''}`,
      url: r.link?.trim() ?? '',
    })
  }

  return {
    urls: [...urls],
    snippets,
    rawCount: organicResults.length,
    errorCount: 0,
  }
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

type BrandVariantResult = {
  brand: GoldenBrand
  variant: { id: string; label: string }
  query: string
  parsed: ParsedResult
  timestamp: string
}

type TestRun = {
  runAt: string
  brands: GoldenBrand[]
  variants: Array<{ id: string; label: string }>
  results: BrandVariantResult[]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) {
    console.error('SERPER_API_KEY not set. Add it to .env.local')
    process.exit(1)
  }

  const outDir = resolve(import.meta.dirname ?? '.', 'serp-results')
  mkdirSync(outDir, { recursive: true })

  const results: BrandVariantResult[] = []
  const totalCalls = GOLDEN_BRANDS.length * VARIANTS.length
  let completed = 0

  console.log(`\nSERP Query Test — ${GOLDEN_BRANDS.length} brands × ${VARIANTS.length} variants = ${totalCalls} queries\n`)

  for (const brand of GOLDEN_BRANDS) {
    console.log(`━━ ${brand.name} (${brand.difficulty}) ━━`)

    for (const variant of VARIANTS) {
      const query = variant.build(brand)
      completed++
      console.log(`  [${completed}/${totalCalls}] Variant ${variant.id}: ${query}`)

      const entries = await fetchSerp(query, apiKey)
      const parsed = parseEntries(entries)

      console.log(`    → ${parsed.urls.length} URLs, ${parsed.snippets.length} snippets${parsed.errorCount > 0 ? `, ${parsed.errorCount} errors` : ''}`)

      results.push({
        brand,
        variant: { id: variant.id, label: variant.label },
        query,
        parsed,
        timestamp: new Date().toISOString(),
      })

      // Rate limit: 1.5s between calls
      if (completed < totalCalls) {
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    console.log()
  }

  // Save full results
  const run: TestRun = {
    runAt: new Date().toISOString(),
    brands: GOLDEN_BRANDS,
    variants: VARIANTS.map((v) => ({ id: v.id, label: v.label })),
    results,
  }

  const outPath = resolve(outDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(outPath, JSON.stringify(run, null, 2))
  console.log(`Full results saved to: ${outPath}\n`)

  // Print comparison summary
  printSummary(results)
}

// ---------------------------------------------------------------------------
// Summary output
// ---------------------------------------------------------------------------

function printSummary(results: BrandVariantResult[]): void {
  console.log('┌─────────────────────────────────┬──────┬──────┬──────┐')
  console.log('│ Brand                           │  A   │  B   │  C   │')
  console.log('├─────────────────────────────────┼──────┼──────┼──────┤')

  const variantTotals: Record<string, { urls: number; snippets: number }> = {
    A: { urls: 0, snippets: 0 },
    B: { urls: 0, snippets: 0 },
    C: { urls: 0, snippets: 0 },
  }

  for (const brand of GOLDEN_BRANDS) {
    const row = results.filter((r) => r.brand.slug === brand.slug)
    const cells = VARIANTS.map((v) => {
      const r = row.find((r) => r.variant.id === v.id)
      if (!r) return '  -  '
      variantTotals[v.id].urls += r.parsed.urls.length
      variantTotals[v.id].snippets += r.parsed.snippets.length
      return `${String(r.parsed.urls.length).padStart(2)}u ${String(r.parsed.snippets.length).padStart(2)}s`
    })

    const name = brand.name.length > 31 ? brand.name.slice(0, 28) + '...' : brand.name.padEnd(31)
    console.log(`│ ${name} │ ${cells.join(' │ ')} │`)
  }

  console.log('├─────────────────────────────────┼──────┼──────┼──────┤')
  const totals = VARIANTS.map((v) => {
    const t = variantTotals[v.id]
    return `${String(t.urls).padStart(2)}u ${String(t.snippets).padStart(2)}s`
  })
  console.log(`│ ${'TOTAL'.padEnd(31)} │ ${totals.join(' │ ')} │`)
  console.log('└─────────────────────────────────┴──────┴──────┴──────┘')

  console.log('\nu = unique URLs found, s = snippets with content')
  console.log('\nNext: open the JSON file and score each brand × variant using the rubric.')
  console.log('Scoring guide: Own URL (0-5) + Brand Facts (0-5) + Ext Voice (0-4) + S/N (0-4) + Metadata (0-2) = max 20/brand\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
