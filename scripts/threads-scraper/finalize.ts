/**
 * Step 4: Finalize enriched CSV for bulk import.
 *
 * - Cleans brand names (strips page-title junk)
 * - Maps categoryHints to valid productType slugs
 * - Validates descriptions (40+ char minimum)
 * - Drops informational columns (categoryHints, scrapeStatus)
 * - Outputs a bulk-import-ready CSV
 *
 * Usage:
 *   pnpm tsx scripts/threads-scraper/finalize.ts scripts/threads-scraper/output/<name>.enriched.csv
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

type ProductTypeSlug = (typeof PRODUCT_TYPE_CATEGORIES)[number]['slug']

// Keyword → slug mapping for auto-categorization from categoryHints
const HINT_KEYWORD_MAP: Record<string, ProductTypeSlug> = {
  // bags-accessories
  bag: 'bags-accessories',
  bags: 'bags-accessories',
  backpack: 'bags-accessories',
  包: 'bags-accessories',
  背包: 'bags-accessories',
  後背包: 'bags-accessories',
  側背包: 'bags-accessories',
  帆布包: 'bags-accessories',
  書包: 'bags-accessories',
  腰包: 'bags-accessories',
  皮包: 'bags-accessories',
  錢包: 'bags-accessories',
  短夾: 'bags-accessories',
  配件: 'bags-accessories',
  wallet: 'bags-accessories',
  purse: 'bags-accessories',
  tote: 'bags-accessories',
  pouch: 'bags-accessories',

  // fashion (avoid 時尚 — too generic, used in bag descriptions)
  服飾: 'fashion',
  球衣: 'fashion',
  棒球衣: 'fashion',
  棒球衫: 'fashion',
  帽t: 'fashion',
  服飾品牌: 'fashion',
  機能服飾: 'fashion',
  fashion: 'fashion',
  apparel: 'fashion',
  clothing: 'fashion',
  shirt: 'fashion',
  jersey: 'fashion',

  // outdoor
  outdoor: 'outdoor',
  戶外: 'outdoor',
  登山: 'outdoor',
  運動: 'outdoor',
  climbing: 'outdoor',
  rock: 'outdoor',
  sport: 'outdoor',
  sports: 'outdoor',

  // crafts
  craft: 'crafts',
  crafts: 'crafts',
  文創: 'crafts',
  手作: 'crafts',
  stationery: 'crafts',
  illustration: 'crafts',
  art: 'crafts',

  // kids-pets (媽媽包 is bags-accessories, not kids; 親子品牌 is kids)
  嬰兒: 'kids-pets',
  baby: 'kids-pets',
  kids: 'kids-pets',
  親子品牌: 'kids-pets',
  母嬰: 'kids-pets',
  寵物: 'kids-pets',
  嬰幼兒: 'kids-pets',

  // beauty
  beauty: 'beauty',
  美妝: 'beauty',
  保養: 'beauty',
  skincare: 'beauty',

  // home (avoid 生活 — too generic in Chinese descriptions)
  home: 'home',
  居家: 'home',
  居家生活: 'home',
  living: 'home',

  // food-drink
  food: 'food-drink',
  飲料: 'food-drink',
  食品: 'food-drink',
  tea: 'food-drink',

  // jewelry
  jewelry: 'jewelry',
  飾品珠寶: 'jewelry',
  珠寶: 'jewelry',

  // tech
  tech: 'tech',
  '3c': 'tech',
  科技: 'tech',
  electronics: 'tech',
}

// Patterns to strip from scraped brand names (applied in order)
const NAME_CLEANUP_PATTERNS = [
  /\s*[｜|│–—]\s*.+$/,           // "Brand｜Home", "Brand | Tagline..."
  /\s*[-]\s*.{8,}$/,             // "Brand - Long description..."
  /\s*官方.*$/,                   // "Brand官方網站"
  /\s*推薦.*$/,                   // "Brand推薦..."
  /\s*首選.*$/,                   // "Brand首選"
]

// Full page-title overrides: if the name starts with these, extract the brand
const TITLE_PREFIX_OVERRIDES: Array<[RegExp, string]> = [
  [/^手工訂製帆布包\s*/, ''],          // "手工訂製帆布包 niizo" → "niizo"
  [/^TAIWOLF\s+TAIWOLF/, 'TAIWOLF'],  // "TAIWOLF TAIWOLF台灣狼" → "TAIWOLF台灣狼"
]

// Suffixes commonly appended to brand names from OG/meta titles
const TITLE_SUFFIX_PATTERNS = [
  /環保後背包.*/,           // "SOLIS環保後背包推薦"
  /後背包.*/,              // attached product category
  /\s*官方網站$/,
  /\s*｜官方.*$/,
]

interface CSVRow {
  [key: string]: string
}

function parseCSV(text: string): CSVRow[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++
      lines.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) lines.push(current)

  if (lines.length < 2) return []

  const headers = splitCSVLine(lines[0])
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const cells = splitCSVLine(line)
    const row: CSVRow = {}
    headers.forEach((h, i) => { row[h.trim()] = cells[i] ?? '' })
    return row
  })
}

function splitCSVLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return cells
}

function cleanBrandName(name: string): string {
  let cleaned = name.trim()

  // Apply prefix overrides first
  for (const [pattern, replacement] of TITLE_PREFIX_OVERRIDES) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, replacement)
      break
    }
  }

  // Strip separator-based suffixes
  for (const pattern of NAME_CLEANUP_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }

  // Strip product-category suffixes baked into page titles
  for (const pattern of TITLE_SUFFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }

  return cleaned.trim()
}

function mapHintsToProductTypes(
  hints: string,
  existingTypes: string,
  description: string = '',
  brandHighlights: string = '',
): ProductTypeSlug[] {
  // If productTypes already set, validate and return
  if (existingTypes.trim()) {
    const existing = existingTypes.split('|').map(s => s.trim()).filter(Boolean)
    const validSlugs = PRODUCT_TYPE_CATEGORIES.map(c => c.slug)
    const valid = existing.filter(s => validSlugs.includes(s as ProductTypeSlug))
    if (valid.length > 0) return valid as ProductTypeSlug[]
  }

  // Combine all text sources for keyword matching
  const allText = [hints, description, brandHighlights].join(' ')
  if (!allText.trim()) return []

  const matched = new Set<ProductTypeSlug>()
  const lowerText = allText.toLowerCase()

  for (const [keyword, slug] of Object.entries(HINT_KEYWORD_MAP)) {
    const kw = keyword.toLowerCase()
    // For short English keywords (≤5 chars), require word boundaries
    if (/^[a-z]+$/.test(kw) && kw.length <= 5) {
      const wordBoundary = new RegExp(`\\b${kw}\\b`, 'i')
      if (wordBoundary.test(allText)) {
        matched.add(slug)
      }
    } else {
      if (lowerText.includes(kw)) {
        matched.add(slug)
      }
    }
  }

  return [...matched]
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const FINAL_COLUMNS = [
  'name', 'description', 'productTypes', 'productTypeNote',
  'website', 'instagram', 'threads', 'facebook',
  'logoUrl', 'productPhotos', 'brandHighlights',
] as const

function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: pnpm tsx scripts/threads-scraper/finalize.ts <enriched.csv>')
    process.exit(1)
  }

  const absPath = resolve(inputPath)
  const raw = readFileSync(absPath, 'utf-8')
  const rows = parseCSV(raw)

  console.error(`Processing ${rows.length} brands...`)

  const warnings: string[] = []
  const finalRows: string[] = []

  for (const row of rows) {
    // Clean name
    const cleanedName = cleanBrandName(row.name || '')
    if (!cleanedName) {
      warnings.push(`Skipping row with empty name`)
      continue
    }

    // Validate description
    const desc = (row.description || '').trim()

    // Map productTypes
    const productTypes = mapHintsToProductTypes(
      row.categoryHints || '',
      row.productTypes || '',
      desc,
      row.brandHighlights || '',
    )
    if (!desc) {
      warnings.push(`${cleanedName}: MISSING description (required, 40+ chars)`)
    } else if (desc.length < 40) {
      warnings.push(`${cleanedName}: description too short (${desc.length} chars, need 40+)`)
    }

    // Validate productTypes
    if (productTypes.length === 0 && !(row.productTypeNote || '').trim()) {
      warnings.push(`${cleanedName}: no productTypes mapped and no productTypeNote`)
    }

    // Build final row
    const finalRow: Record<string, string> = {
      name: cleanedName,
      description: desc,
      productTypes: productTypes.join(' | '),
      productTypeNote: row.productTypeNote || '',
      website: row.website || '',
      instagram: row.instagram || '',
      threads: row.threads || '',
      facebook: row.facebook || '',
      logoUrl: row.logoUrl || '',
      productPhotos: row.productPhotos || '',
      brandHighlights: row.brandHighlights || '',
    }

    const csvLine = FINAL_COLUMNS.map(col => escapeCSV(finalRow[col])).join(',')
    finalRows.push(csvLine)

    const status = warnings.length > 0 ? '⚠' : '✓'
    console.error(`  ${status} ${cleanedName} → [${productTypes.join(', ')}]`)
  }

  // Write output
  const header = FINAL_COLUMNS.join(',')
  const csv = [header, ...finalRows].join('\n')

  const outName = basename(absPath).replace('.enriched.csv', '.final.csv')
  const outPath = resolve(dirname(absPath), outName)
  writeFileSync(outPath, csv, 'utf-8')

  console.error(`\nWrote ${finalRows.length} brands to ${outPath}`)

  if (warnings.length > 0) {
    console.error(`\n${warnings.length} warnings:`)
    warnings.forEach(w => console.error(`  ⚠ ${w}`))
    console.error('\nFix these before uploading to /admin/import')
  } else {
    console.error('\nAll validations passed — ready for /admin/import')
  }
}

main()
