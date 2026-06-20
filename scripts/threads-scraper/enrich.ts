/**
 * Brand Enrichment Script — Step 3 of the Bulk Import Workflow
 *
 * Reads a Claude-extracted brands JSON (step 2 output), scrapes each brand's
 * website using the project's existing scrapeBrandUrls, and outputs a
 * bulk-import-ready CSV.
 *
 * Usage:
 *   pnpm tsx scripts/threads-scraper/enrich.ts scripts/threads-scraper/output/brands-extracted.json
 *
 * Input format (JSON array):
 *   [
 *     { "name": "Hanchor", "url": "https://www.hanchor.com", "context": "背包" },
 *     { "name": "Dydash", "url": "https://www.dydash.com" }
 *   ]
 *
 * Output:
 *   Writes CSV to same directory as input, e.g. brands-extracted.enriched.csv
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { searchBrandWebsite, SEARCH_DELAY_MS } from '@/lib/services/scraper/search'
import type { ScrapedBrandData } from '@/lib/types/scraper'

interface BrandInput {
  name: string
  url?: string
  instagram?: string
  threads?: string
  facebook?: string
  context?: string
  productType?: string
}

interface EnrichedBrand {
  name: string
  description: string
  productTypes: string
  productTypeNote: string
  website: string
  instagram: string
  threads: string
  facebook: string
  heroImageUrl: string
  productPhotos: string
  brandHighlights: string
  categoryHints: string
  scrapeStatus: string
}

const SCRAPE_DELAY_MS = 1000

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function buildCSVRow(brand: EnrichedBrand): string {
  const columns: (keyof EnrichedBrand)[] = [
    'name',
    'description',
    'productTypes',
    'productTypeNote',
    'website',
    'instagram',
    'threads',
    'facebook',
    'heroImageUrl',
    'productPhotos',
    'brandHighlights',
    'categoryHints',
    'scrapeStatus',
  ]
  return columns.map((col) => escapeCSV(brand[col])).join(',')
}

const NON_BRAND_PATTERNS: Array<[RegExp, string]> = [
  // Junk / scraped noise
  [/創生夥伴介紹/, 'Partner intro page, not a brand'],
  [/^[\d]+$/, 'Pure number'],
  [/^[#＃]/, 'Hashtag, not a brand'],
  [/^主頁\s*[-—]/, 'Homepage title, not a brand'],

  // Organizations / NPOs
  [/協會$/, 'Association/NPO, not a product brand'],
  [/基金會/, 'Foundation, not a product brand'],
  [/合作社/, 'Cooperative, not a product brand'],

  // Cultural / entertainment venues
  [/博物館/, 'Museum, not a product brand'],
  [/美術館/, 'Art museum, not a product brand'],
  [/紀念館/, 'Memorial hall, not a product brand'],
  [/展覽館/, 'Exhibition hall, not a product brand'],
  [/劇團/, 'Theater troupe, not a product brand'],
  [/樂團$/, 'Music band, not a product brand'],
  [/園區/, 'Park/venue, not a product brand'],
  [/地質公園/, 'Geo park, not a product brand'],

  // Hospitality / food service (serve, don't sell products)
  [/民宿/, 'B&B/lodging, not a product brand'],
  [/飯店/, 'Hotel, not a product brand'],
  [/旅館/, 'Inn, not a product brand'],
  [/酒店/, 'Hotel, not a product brand'],
  [/餐廳/, 'Restaurant, not a product brand'],
  [/咖啡廳/, 'Cafe, not a product brand'],
  [/食堂/, 'Eatery, not a product brand'],

  // Service / experience (not selling products)
  [/換宿/, 'Work-exchange stay, not a product brand'],
  [/散策/, 'Walking tour, not a product brand'],
  [/補習班/, 'Cram school, not a product brand'],
  [/教會$/, 'Church, not a product brand'],
  [/休閒農場/, 'Leisure farm attraction, not a product brand'],
  [/觀光工廠/, 'Tourist factory attraction, not a product brand'],
  [/批發/, 'Wholesale, not a product brand'],
]

function isLikelyBrand(name: string): { valid: boolean; reason?: string } {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length < 2) {
    return { valid: false, reason: 'Name too short or empty' }
  }
  if (trimmed.length > 80) {
    return { valid: false, reason: 'Name too long — likely a description' }
  }
  if (/[！？]/.test(trimmed) || (/。/.test(trimmed) && trimmed.length > 20)) {
    return { valid: false, reason: 'Contains sentence punctuation — likely a description' }
  }
  if (/^[『「《]/.test(trimmed) && trimmed.length > 20) {
    return { valid: false, reason: 'Quoted long text — likely a description' }
  }
  for (const [pattern, reason] of NON_BRAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason }
    }
  }
  return { valid: true }
}

const JUNK_NAMES = ['google', 'gmail', 'instagram', 'facebook', 'threads', 'pinkoi',
  'shopee', 'momo購物網', '首頁', 'line', '縮短網址', 'shopline', 'yahoo', '蝦皮']

function pickBestName(inputName: string, scrapedName: string | undefined): string {
  if (!scrapedName) return inputName
  const lower = scrapedName.toLowerCase()
  if (JUNK_NAMES.some(j => lower.startsWith(j) || lower === j)) return inputName
  if (scrapedName.length > 80) return inputName
  if (scrapedName.startsWith('(') || scrapedName.startsWith('@')) return inputName
  return scrapedName
}

function mergeToEnriched(input: BrandInput, scraped: ScrapedBrandData | null): EnrichedBrand {
  const s = scraped
  return {
    name: pickBestName(input.name, s?.brandName ?? undefined),
    description: s?.description || s?.story || '',
    productTypes: input.productType || '',
    productTypeNote: '',
    website: s?.websiteUrl || input.url || '',
    instagram: s?.socialInstagram || input.instagram || '',
    threads: s?.socialThreads || input.threads || '',
    facebook: s?.socialFacebook || input.facebook || '',
    heroImageUrl: s?.heroImageUrl || '',
    productPhotos: s?.galleryImageUrls.join(' | ') || '',
    brandHighlights: input.context || '',
    categoryHints: s?.categoryHints.join(' | ') || '',
    scrapeStatus: s ? 'ok' : (input.url ? 'scrape-failed' : (input.instagram || input.facebook ? 'social-only' : 'no-url')),
  }
}

async function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: pnpm tsx scripts/threads-scraper/enrich.ts <brands.json>')
    process.exit(1)
  }

  const absPath = resolve(inputPath)
  const allBrands: BrandInput[] = JSON.parse(readFileSync(absPath, 'utf-8'))
  console.error(`Loaded ${allBrands.length} entries, filtering non-brands...`)

  const filtered: Array<{ name: string; reason: string }> = []
  const brands = allBrands.filter((b) => {
    const check = isLikelyBrand(b.name)
    if (!check.valid) {
      console.error(`  [skip] "${b.name}" — ${check.reason}`)
      filtered.push({ name: b.name, reason: check.reason! })
      return false
    }
    return true
  })

  console.error(`\n${brands.length} brands to enrich (${filtered.length} filtered out)\n`)

  const results: EnrichedBrand[] = []

  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i]
    console.error(`[${i + 1}/${brands.length}] ${brand.name}...`)

    let scraped: ScrapedBrandData | null = null

    if (!brand.url && !brand.instagram && !brand.facebook) {
      console.error('  → no URL, searching for official website...')
      const found = await searchBrandWebsite(brand.name)
      if (found) {
        console.error(`  → found: ${found}`)
        brand.url = found
      } else {
        console.error('  → no official website found')
      }
      await delay(SEARCH_DELAY_MS)
    }

    const urls: string[] = []
    if (brand.url) urls.push(brand.url)
    if (brand.instagram) urls.push(brand.instagram)
    if (brand.facebook) urls.push(brand.facebook)

    if (urls.length > 0) {
      try {
        scraped = (await (await import('@/lib/services/scraper')).scrapeBrandUrls(urls)).data
        console.error(`  → scraped: ${scraped.brandName || '(no name)'}, ${scraped.galleryImageUrls.length} photos, hints: [${scraped.categoryHints.join(', ')}]`)
      } catch (err) {
        console.error(`  → scrape failed: ${err instanceof Error ? err.message : err}`)
      }
    } else {
      console.error('  → no URL or social links, skipping scrape')
    }

    results.push(mergeToEnriched(brand, scraped))

    if (i < brands.length - 1) {
      await delay(SCRAPE_DELAY_MS)
    }
  }

  const header = 'name,description,productTypes,productTypeNote,website,instagram,threads,facebook,heroImageUrl,productPhotos,brandHighlights,categoryHints,scrapeStatus'
  const rows = results.map(buildCSVRow)
  const csv = [header, ...rows].join('\n')

  const outName = basename(absPath, '.json') + '.enriched.csv'
  const outPath = resolve(dirname(absPath), outName)
  writeFileSync(outPath, csv, 'utf-8')

  console.error(`\nWrote ${results.length} brands to ${outPath}`)
  console.error('\nNext step: paste the CSV into a Claude Code session to fill in productTypes.')

  const noUrl = results.filter((r) => r.scrapeStatus === 'no-url')
  const noDesc = results.filter((r) => !r.description)
  if (noUrl.length > 0) {
    console.error(`\n⚠ ${noUrl.length} brands had no URL — need manual description:`)
    noUrl.forEach((b) => console.error(`  - ${b.name}`))
  }
  if (noDesc.length > 0) {
    console.error(`\n⚠ ${noDesc.length} brands have empty description (required, 40+ chars):`)
    noDesc.forEach((b) => console.error(`  - ${b.name}`))
  }

  if (filtered.length > 0) {
    console.error(`\n🚫 ${filtered.length} entries filtered out (not product brands):`)
    filtered.forEach((f) => console.error(`  - "${f.name}" — ${f.reason}`))
    const filteredPath = resolve(dirname(absPath), basename(absPath, '.json') + '.filtered.json')
    writeFileSync(filteredPath, JSON.stringify(filtered, null, 2))
    console.error(`  → Saved to ${filteredPath} for review`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
