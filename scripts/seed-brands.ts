/**
 * Bulk import script: taiwan-brands → MitMap database
 *
 * Fetches https://github.com/kun1225/taiwan-brands normalized brand data,
 * maps to MitMap's schema, and bulk-inserts with ON CONFLICT DO NOTHING logic.
 *
 * Usage:
 *   npx tsx scripts/seed-brands.ts
 *
 * Requires env vars (auto-loaded from .env.local if present):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// 1. Load environment variables
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const envLocalPath = path.join(ROOT, '.env.local')

if (fs.existsSync(envLocalPath)) {
  const envContents = fs.readFileSync(envLocalPath, 'utf-8')
  for (const line of envContents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    // Strip surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
  console.log(`Loaded env from ${envLocalPath}`)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '\nError: Missing required environment variables.\n' +
      'Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set\n' +
      'either in your environment or in a .env.local file at the project root.\n\n' +
      'Example .env.local:\n' +
      '  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co\n' +
      '  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key\n'
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// ---------------------------------------------------------------------------
// 2. Source data types
// ---------------------------------------------------------------------------

interface SourceBrand {
  brandName: string
  category: string
  confidence?: string
  evidenceTags?: string[]
  mainProducts?: string
  officialUrl?: string
  officialUrlType?: string
  productImageUrls?: string[]
  searchCategories?: string[]
  sourceName?: string
  sourceUrl?: string
}

// ---------------------------------------------------------------------------
// 3. Taxonomy mapping
// ---------------------------------------------------------------------------

// Maps taxonomy tag slug → keywords to match against (lowercase)
const TAXONOMY_KEYWORD_MAP: Record<string, string[]> = {
  accessories: [
    '包', '袋', 'bag', '飾品', 'jewelry', 'earring', 'necklace', 'bracelet',
    '鞋', 'shoe', 'accessori',
  ],
  clothing: [
    '服飾', '衣', 'clothing', 'fashion', 'shirt', 'dress', 'apparel', '服',
  ],
  food: [
    '食', '茶', '咖啡', '農產', 'noodle', 'food', 'tea', 'coffee', '米', '醬',
    '餅', '糕', '麵', '肉', '豆', 'snack', '零食',
  ],
  beverages: ['飲', 'drink', 'beverage', '酒', 'wine', 'beer', 'juice', 'bubble'],
  beauty: [
    '美妝', 'skincare', 'cosmetic', 'soap', 'fragrance', '保養', '香皂', '洗',
    '護膚', 'beauty', 'makeup',
  ],
  home: [
    '居家', 'home', 'ceramic', 'candle', 'bowl', 'cup', 'plate', '家居',
    '陶', '瓷', '蠟燭', '碗', '杯', '盤', 'living',
  ],
  furniture: [
    '家具', 'furniture', 'chair', 'table', 'shelf', '椅', '桌', '架', '櫃',
  ],
  stationery: [
    '文具', 'stationery', 'pen', 'notebook', 'paper', '筆', '本', '紙', '印章',
    '貼紙', 'stamp', 'sticker',
  ],
  'tech-accessories': [
    '3c', 'tech', 'phone', 'cable', 'charger', '3C', '手機', '充電', '耳機',
    'electronic', '科技',
  ],
  pets: ['寵物', 'pet', '貓', '狗', 'cat', 'dog', 'animal'],
  outdoor: ['戶外', 'outdoor', 'camping', '露營', '登山', 'hiking', 'sport', '運動'],
  crafts: ['手工', 'craft', 'handmade', 'diy', '工藝', '藝術', '手作', 'art'],
  'baby-kids': ['母嬰', 'baby', 'kid', 'child', '嬰', '童', '兒', '玩具', 'toy'],
  cleaning: ['清潔', 'clean', '洗', 'detergent', '打掃', 'hygiene', '消毒'],
}

function mapToTaxonomySlugs(
  category: string,
  searchCategories: string[] = []
): string[] {
  const combined = [category, ...searchCategories].join(' ').toLowerCase()
  const matched: string[] = []

  for (const [slug, keywords] of Object.entries(TAXONOMY_KEYWORD_MAP)) {
    if (keywords.some((kw) => combined.includes(kw.toLowerCase()))) {
      matched.push(slug)
    }
  }

  return [...new Set(matched)]
}

// ---------------------------------------------------------------------------
// 4. Slug generation
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
  // Replace Chinese characters and spaces with hyphens
  let slug = name
    .toLowerCase()
    .replace(/[一-鿿]+/g, '-')   // Chinese chars → hyphen
    .replace(/\s+/g, '-')                 // spaces → hyphen
    .replace(/[^a-z0-9-]/g, '')          // strip non-alphanumeric except hyphens
    .replace(/-{2,}/g, '-')              // collapse multiple hyphens
    .replace(/^-+|-+$/g, '')             // trim leading/trailing hyphens

  // If slug is empty (e.g., purely Chinese name with no Latin chars), use hash
  if (!slug || slug === '') {
    const hash = crypto.createHash('md5').update(name).digest('hex').slice(0, 6)
    slug = `brand-${hash}`
  }

  return slug
}

// ---------------------------------------------------------------------------
// 5. URL classification
// ---------------------------------------------------------------------------

const MARKETPLACE_PATTERNS = [
  'pinkoi.com',
  'shopee.tw',
  'momo',
  'momoshop',
  'ruten.com',
  'yahoo.com',
  'cyberbiz',
  'shopline',
  'aftee',
  'fubon',
  '91app',
]

interface PurchaseLink {
  platform: string
  label: string
  url: string
}

interface SocialLinks {
  official_website?: string
  facebook?: string
  instagram?: string
  youtube?: string
  line?: string
}

function classifyUrl(
  officialUrl: string | undefined,
  officialUrlType: string | undefined
): { purchaseLinks: PurchaseLink[]; socialLinks: SocialLinks } {
  if (!officialUrl) return { purchaseLinks: [], socialLinks: {} }

  const purchaseLinks: PurchaseLink[] = []
  const socialLinks: SocialLinks = {}

  const type = (officialUrlType || '').toLowerCase()
  const url = officialUrl.toLowerCase()

  const isMarketplace =
    MARKETPLACE_PATTERNS.some((p) => url.includes(p)) ||
    type.includes('marketplace') ||
    type.includes('pinkoi') ||
    type.includes('shopee') ||
    type.includes('momo')

  if (isMarketplace) {
    let platform = 'marketplace'
    let label = 'Shop'

    if (url.includes('pinkoi.com')) {
      platform = 'pinkoi'
      label = 'Pinkoi'
    } else if (url.includes('shopee.tw')) {
      platform = 'shopee'
      label = 'Shopee'
    } else if (url.includes('momoshop') || url.includes('momo')) {
      platform = 'momo'
      label = 'momo'
    } else if (url.includes('ruten.com')) {
      platform = 'ruten'
      label = '露天拍賣'
    } else if (url.includes('yahoo.com')) {
      platform = 'yahoo'
      label = 'Yahoo購物'
    } else if (url.includes('shopline')) {
      platform = 'shopline'
      label = 'Shopline'
    } else if (url.includes('cyberbiz')) {
      platform = 'cyberbiz'
      label = 'Cyberbiz'
    }

    purchaseLinks.push({ platform, label, url: officialUrl })
  } else if (url.includes('facebook.com') || url.includes('fb.com')) {
    socialLinks.facebook = officialUrl
  } else if (url.includes('instagram.com')) {
    socialLinks.instagram = officialUrl
  } else if (url.includes('youtube.com')) {
    socialLinks.youtube = officialUrl
  } else if (url.includes('line.me')) {
    socialLinks.line = officialUrl
  } else {
    socialLinks.official_website = officialUrl
  }

  return { purchaseLinks, socialLinks }
}

// ---------------------------------------------------------------------------
// 6. Brand record mapping
// ---------------------------------------------------------------------------

interface MitMapBrand {
  name: string
  slug: string
  description: string | null
  hero_image_url: string | null
  product_photos: string[]
  purchase_links: PurchaseLink[]
  social_links: SocialLinks
  status: 'approved'
  approved_at: string
  submitted_at: string
  created_at: string
  updated_at: string
}

function mapBrand(source: SourceBrand): MitMapBrand {
  const now = new Date().toISOString()
  const { purchaseLinks, socialLinks } = classifyUrl(
    source.officialUrl,
    source.officialUrlType
  )

  return {
    name: source.brandName,
    slug: toSlug(source.brandName),
    description: source.mainProducts || null,
    hero_image_url: source.productImageUrls?.[0] || null,
    product_photos: source.productImageUrls || [],
    purchase_links: purchaseLinks,
    social_links: socialLinks,
    status: 'approved',
    approved_at: now,
    submitted_at: now,
    created_at: now,
    updated_at: now,
  }
}

// ---------------------------------------------------------------------------
// 7. Main import logic
// ---------------------------------------------------------------------------

const BRANDS_URL =
  'https://raw.githubusercontent.com/kun1225/taiwan-brands/main/data/normalized/brands.json'

const BATCH_SIZE = 50

async function main() {
  console.log('Fetching brands from taiwan-brands dataset...')
  console.log(`Source: ${BRANDS_URL}`)

  const response = await fetch(BRANDS_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch brands: ${response.status} ${response.statusText}`)
  }

  const rawBrands: SourceBrand[] = await response.json()
  console.log(`Fetched ${rawBrands.length} brands from source.`)

  // Fetch existing slugs to check for collisions
  console.log('Fetching existing slugs from database...')
  const { data: existingRows, error: slugFetchError } = await supabase
    .from('brands')
    .select('slug')

  if (slugFetchError) {
    throw new Error(`Failed to fetch existing slugs: ${slugFetchError.message}`)
  }

  const existingSlugs = new Set((existingRows || []).map((r: { slug: string }) => r.slug))
  console.log(`Found ${existingSlugs.size} existing brands in database.`)

  // Fetch taxonomy tags for linking
  console.log('Fetching taxonomy tags...')
  const { data: taxonomyRows, error: taxError } = await supabase
    .from('taxonomy_tags')
    .select('id, slug')

  if (taxError) {
    throw new Error(`Failed to fetch taxonomy tags: ${taxError.message}`)
  }

  const tagsBySlug = new Map<string, string>(
    (taxonomyRows || []).map((t: { id: string; slug: string }) => [t.slug, t.id])
  )
  console.log(`Found ${tagsBySlug.size} taxonomy tags.`)

  // Map source brands to MitMap schema, resolving slug collisions
  const slugCounts = new Map<string, number>(
    [...existingSlugs].map((s) => [s, 1])
  )
  const mappedBrands: (MitMapBrand & { _sourceBrand: SourceBrand })[] = []

  for (const source of rawBrands) {
    const brand = mapBrand(source)
    const baseSlug = brand.slug

    // Resolve collision by appending -2, -3, etc.
    let finalSlug = baseSlug
    if (slugCounts.has(baseSlug)) {
      let counter = 2
      while (slugCounts.has(`${baseSlug}-${counter}`)) {
        counter++
      }
      finalSlug = `${baseSlug}-${counter}`
    }
    slugCounts.set(finalSlug, 1)

    brand.slug = finalSlug
    mappedBrands.push({ ...brand, _sourceBrand: source })
  }

  // Separate brands that already exist (skip) vs new ones to insert
  const toInsert = mappedBrands.filter((b) => !existingSlugs.has(b.slug))
  const skipped = mappedBrands.length - toInsert.length

  console.log(`\nPrepared ${toInsert.length} new brands to insert, ${skipped} skipped (duplicates).`)

  if (toInsert.length === 0) {
    console.log('Nothing to insert. Exiting.')
    return
  }

  // Bulk insert in batches
  let insertedCount = 0
  const insertedBrands: Array<{ id: string; slug: string; _sourceBrand: SourceBrand }> = []

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(toInsert.length / BATCH_SIZE)

    process.stdout.write(
      `Inserting brands ${i + 1}–${Math.min(i + BATCH_SIZE, toInsert.length)} of ${toInsert.length} (batch ${batchNum}/${totalBatches})...\r`
    )

    // Strip _sourceBrand before insert
    const rows = batch.map((b) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _sourceBrand, ...rest } = b
      return rest
    })

    const { data: inserted, error } = await supabase
      .from('brands')
      .insert(rows)
      .select('id, slug')

    if (error) {
      // ON CONFLICT: if it's a conflict error, log and continue
      if (error.code === '23505') {
        console.warn(`\nBatch ${batchNum}: Conflict on insert, some rows skipped.`)
        continue
      }
      throw new Error(`Insert failed (batch ${batchNum}): ${error.message}`)
    }

    const batchInserted = inserted || []
    insertedCount += batchInserted.length

    // Map inserted records back to source for taxonomy linking
    for (const insertedRow of batchInserted) {
      const sourceBrand = batch.find((b) => b.slug === insertedRow.slug)
      if (sourceBrand) {
        insertedBrands.push({ ...insertedRow, _sourceBrand: sourceBrand._sourceBrand })
      }
    }
  }

  console.log(`\nInserted ${insertedCount} brands.`)

  // Create taxonomy links
  console.log('Creating taxonomy links...')
  let taxonomyLinksCreated = 0

  const taxonomyRows_toInsert: Array<{ brand_id: string; tag_id: string }> = []

  for (const brand of insertedBrands) {
    const tagSlugs = mapToTaxonomySlugs(
      brand._sourceBrand.category,
      brand._sourceBrand.searchCategories
    )

    for (const tagSlug of tagSlugs) {
      const tagId = tagsBySlug.get(tagSlug)
      if (tagId) {
        taxonomyRows_toInsert.push({ brand_id: brand.id, tag_id: tagId })
      }
    }
  }

  // Insert taxonomy links in batches
  for (let i = 0; i < taxonomyRows_toInsert.length; i += BATCH_SIZE) {
    const batch = taxonomyRows_toInsert.slice(i, i + BATCH_SIZE)

    const { error } = await supabase
      .from('brand_taxonomy')
      .insert(batch)
      .select()

    if (error) {
      if (error.code === '23505') {
        // Conflict — some links already exist, skip
        continue
      }
      throw new Error(`Taxonomy link insert failed: ${error.message}`)
    }

    taxonomyLinksCreated += batch.length
  }

  console.log(
    `\n${'='.repeat(60)}\n` +
      `Summary:\n` +
      `  Source brands fetched:    ${rawBrands.length}\n` +
      `  New brands inserted:      ${insertedCount}\n` +
      `  Skipped (duplicates):     ${skipped}\n` +
      `  Taxonomy links created:   ${taxonomyLinksCreated}\n` +
      `${'='.repeat(60)}`
  )
}

main().catch((err) => {
  console.error('\nFatal error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
