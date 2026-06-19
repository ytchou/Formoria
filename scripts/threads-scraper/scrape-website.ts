/**
 * Website Scraper — Step 1-alt of the Bulk Import Workflow
 *
 * Scrapes a paginated brand directory and outputs a brands JSON
 * compatible with Step 3 (enrich.ts).
 *
 * Usage:
 *   pnpm tsx scripts/threads-scraper/scrape-website.ts "https://taiwan-brands.vercel.app/" --name taiwan-brands
 *
 * Output:
 *   scripts/threads-scraper/output/taiwan-brands-2026-06-17-brands.json
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as cheerio from 'cheerio'

interface BrandEntry {
  name: string
  url?: string
  context?: string
}

async function fetchPage(baseUrl: string, page: number): Promise<string> {
  const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.text()
}

function parseBrands(html: string): BrandEntry[] {
  const $ = cheerio.load(html)
  const brands: BrandEntry[] = []

  $('a:has(h3)').each((_, el) => {
    const $el = $(el)
    const name = $el.find('h3').text().trim()
    const href = $el.attr('href')

    const noise = [
      '平台認證', '社群推薦名錄收錄', '社群推薦', '社群推薦多人推薦',
      '暫無圖片', '多人推薦',
    ]
    const divs = $el.find('div')
    const categories: string[] = []
    divs.each((_, div) => {
      let text = $(div).text().trim()
      if (!text) return
      if (text.startsWith(name)) text = text.slice(name.length)
      for (const n of noise) text = text.replaceAll(n, '')
      text = text.replace(/^[、,\s]+|[、,\s]+$/g, '').trim()
      if (text) categories.push(text)
    })

    if (!name) return

    const entry: BrandEntry = { name }
    if (href && !href.startsWith('/')) {
      entry.url = href
    }
    if (categories.length > 0) {
      entry.context = categories.join('、')
    }

    brands.push(entry)
  })

  return brands
}

function detectTotalPages(html: string): number {
  const $ = cheerio.load(html)
  let max = 1
  $('a[href*="?page="]').each((_, el) => {
    const match = $(el).attr('href')?.match(/\?page=(\d+)/)
    if (match) {
      const p = parseInt(match[1], 10)
      if (p > max) max = p
    }
  })
  return max
}

async function main() {
  const args = process.argv.slice(2)
  const baseUrl = args[0]
  const nameIdx = args.indexOf('--name')
  const name = nameIdx !== -1 ? args[nameIdx + 1] : 'website'

  if (!baseUrl) {
    console.error(
      'Usage: pnpm tsx scripts/threads-scraper/scrape-website.ts <url> --name <topic>'
    )
    process.exit(1)
  }

  console.log(`Fetching page 1 of ${baseUrl}...`)
  const firstPageHtml = await fetchPage(baseUrl, 1)
  const totalPages = detectTotalPages(firstPageHtml)
  console.log(`Detected ${totalPages} pages.`)

  const allBrands: BrandEntry[] = []
  allBrands.push(...parseBrands(firstPageHtml))
  console.log(`Page 1: ${allBrands.length} brands`)

  for (let page = 2; page <= totalPages; page++) {
    await new Promise((r) => setTimeout(r, 1000))
    console.log(`Fetching page ${page}/${totalPages}...`)
    const html = await fetchPage(baseUrl, page)
    const brands = parseBrands(html)
    allBrands.push(...brands)
    console.log(`Page ${page}: ${brands.length} brands (total: ${allBrands.length})`)
  }

  const seen = new Set<string>()
  const deduped = allBrands.filter((b) => {
    const key = b.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  console.log(`\nTotal: ${deduped.length} unique brands (${allBrands.length - deduped.length} duplicates removed)`)

  const date = new Date().toISOString().slice(0, 10)
  const outPath = resolve(
    import.meta.dirname,
    'output',
    `${name}-${date}-brands.json`
  )
  writeFileSync(outPath, JSON.stringify(deduped, null, 2))
  console.log(`Written to ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
