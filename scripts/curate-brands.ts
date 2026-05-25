import type { Brand, SocialLinks } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import { getBrands, updateBrand } from '@/lib/services/brands'
import { getTags } from '@/lib/services/taxonomy'
import { scrapeBrandUrl } from '@/lib/services/scraper'
import { downloadAndStoreImages } from '@/lib/services/image-download'
import { createServiceClient } from '@/lib/supabase/server'

const TOP_N = 30
const SCRAPE_DELAY_MS = 2_000
const MAX_PRODUCT_PHOTOS = 5

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function scoreBrand(brand: Brand): {
  score: number
  websiteUrl: string | null
} {
  let score = 0

  // description: 15 pts — non-null, > 20 chars
  if (brand.description && brand.description.length > 20) {
    score += 15
  }

  // heroImageUrl: 15 pts — non-null
  if (brand.heroImageUrl) {
    score += 15
  }

  // productPhotos: 15 pts — length >= 2
  if (brand.productPhotos.length >= 2) {
    score += 15
  }

  // socialLinks: 10 pts — >= 1 link
  const socialValues = Object.values(brand.socialLinks).filter(Boolean)
  if (socialValues.length >= 1) {
    score += 10
  }

  // officialWebsite: 10 pts — has scrapeable URL
  const websiteUrl =
    brand.socialLinks.officialWebsite ||
    (brand.purchaseLinks.length > 0 ? brand.purchaseLinks[0].url : null) ||
    null

  if (brand.socialLinks.officialWebsite) {
    score += 10
  }

  // purchaseLinks: 10 pts — length >= 1
  if (brand.purchaseLinks.length >= 1) {
    score += 10
  }

  // founder: 10 pts — has name
  if (brand.founder?.name) {
    score += 10
  }

  // brandHighlights: 10 pts — has text
  if (brand.brandHighlights != null && brand.brandHighlights.length > 0) {
    score += 10
  }

  // category: 5 pts — non-null
  if (brand.category) {
    score += 5
  }

  // Penalty: -50 if no scrapeable URL
  if (!websiteUrl) {
    score -= 50
  }

  return { score, websiteUrl }
}

// ---------------------------------------------------------------------------
// Merge strategy (fill-gaps-only)
// ---------------------------------------------------------------------------

export function buildEnrichPatch(
  brand: Brand,
  scraped: ScrapedBrandData
): Partial<Brand> {
  const patch: Partial<Brand> = {}

  // Fill description when brand has none or it's too short (< 20 chars)
  if ((!brand.description || brand.description.length < 20) && scraped.description && scraped.description.length >= 20) {
    patch.description = scraped.description
  }

  // Merge social links: preserve existing, fill missing
  const existingLinks = brand.socialLinks
  const scrapedLinks = scraped.socialLinks
  const mergedLinks: SocialLinks = { ...existingLinks }
  let hasNewLink = false

  const linkKeys = ['instagram', 'threads', 'facebook'] as const
  for (const key of linkKeys) {
    if (!existingLinks[key] && scrapedLinks[key]) {
      mergedLinks[key] = scrapedLinks[key]!
      hasNewLink = true
    }
  }

  if (hasNewLink) {
    patch.socialLinks = mergedLinks
  }

  // Fill founder from scraped JSON-LD if brand has no founder yet
  if (!brand.founder && scraped.founderName) {
    patch.founder = {
      name: scraped.founderName,
      title: scraped.founderTitle || null,
      avatarUrl: null,
      quote: null,
    }
  }

  // Fill brandHighlights from scraped description if brand has none
  if (!brand.brandHighlights && scraped.brandHighlights) {
    patch.brandHighlights = scraped.brandHighlights
  }

  return patch
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isShowcaseReady(brand: Brand): boolean {
  return Boolean(
    brand.description && brand.description.length > 20 &&
    brand.heroImageUrl &&
    brand.category &&
    Object.values(brand.socialLinks).some(Boolean) &&
    brand.productPhotos.length >= 2
  )
}

async function scoreAndScrape(dryRun: boolean, targetSlugs?: string[], stopAfter?: number): Promise<void> {
  console.log('Fetching all brands...')
  const { brands } = await getBrands({ limit: 1000 })
  console.log(`Found ${brands.length} brands`)

  // Score and rank — optionally filter to target slugs
  const scored = brands.map((brand) => ({ brand, ...scoreBrand(brand) }))
  const ranked = targetSlugs
    ? scored.filter(({ brand }) => targetSlugs.includes(brand.slug))
    : scored.sort((a, b) => b.score - a.score).slice(0, TOP_N)

  if (targetSlugs) {
    const found = ranked.map(({ brand }) => brand.slug)
    const missing = targetSlugs.filter((s) => !found.includes(s))
    if (missing.length > 0) {
      console.error(`Missing slugs: ${missing.join(', ')}`)
      process.exit(1)
    }
  }

  // Print ranked table
  console.log('\n  #  | Score | Slug                          | Website URL')
  console.log('-----|-------|-------------------------------|-----------------------------')
  ranked.forEach(({ brand, score, websiteUrl }, i) => {
    const idx = String(i + 1).padStart(3)
    const sc = String(score).padStart(5)
    const slug = brand.slug.padEnd(30).slice(0, 30)
    const url = websiteUrl ?? '(none)'
    console.log(`${idx}  | ${sc} | ${slug}| ${url}`)
  })

  if (dryRun) {
    console.log('\nDry run — no changes made.')
    return
  }

  console.log(`\nEnriching top ${ranked.length} brands...`)
  if (stopAfter) console.log(`  (will stop after ${stopAfter} showcase-ready brands)\n`)

  const summary: { slug: string; fields: string[]; images: number; showcaseReady: boolean }[] = []
  let goodCount = 0

  for (const { brand, websiteUrl } of ranked) {
    if (!websiteUrl) {
      console.log(`  [SKIP] ${brand.slug} — no scrapeable URL`)
      summary.push({ slug: brand.slug, fields: [], images: 0, showcaseReady: false })
      continue
    }

    console.log(`  [SCRAPE] ${brand.slug} → ${websiteUrl}`)

    let scraped: ScrapedBrandData
    try {
      scraped = await scrapeBrandUrl(websiteUrl)
    } catch (err) {
      console.warn(`  [ERROR] Scrape failed for ${brand.slug}:`, err)
      summary.push({ slug: brand.slug, fields: ['scrape-error'], images: 0, showcaseReady: false })
      await sleep(SCRAPE_DELAY_MS)
      continue
    }

    // Build text patch
    const patch = buildEnrichPatch(brand, scraped)
    const enrichedFields = Object.keys(patch)

    // Handle images
    const imageUrls: string[] = []
    if (!brand.heroImageUrl && scraped.heroImageUrl) {
      imageUrls.push(scraped.heroImageUrl)
    }
    const currentPhotoCount = brand.productPhotos.length
    if (currentPhotoCount < 3 && scraped.galleryImageUrls.length > 0) {
      const slotsAvailable = MAX_PRODUCT_PHOTOS - currentPhotoCount
      // Skip the first gallery image if we're also using it as hero
      const galleryStart = imageUrls.length > 0 ? 1 : 0
      imageUrls.push(
        ...scraped.galleryImageUrls.slice(galleryStart, galleryStart + slotsAvailable)
      )
    }

    let downloadedImages: string[] = []
    if (imageUrls.length > 0) {
      try {
        downloadedImages = await downloadAndStoreImages(imageUrls, brand.id)
      } catch (err) {
        console.warn(`  [ERROR] Image download failed for ${brand.slug}:`, err)
      }
    }

    // Merge downloaded image URLs into patch
    let imageIdx = 0
    if (!brand.heroImageUrl && scraped.heroImageUrl && downloadedImages.length > 0) {
      patch.heroImageUrl = downloadedImages[imageIdx]
      imageIdx++
      enrichedFields.push('heroImageUrl')
    }

    const newPhotos = downloadedImages.slice(imageIdx)
    if (newPhotos.length > 0) {
      patch.productPhotos = [
        ...brand.productPhotos,
        ...newPhotos,
      ].slice(0, MAX_PRODUCT_PHOTOS)
      enrichedFields.push('productPhotos')
    }

    // Apply patch
    if (Object.keys(patch).length > 0) {
      try {
        await updateBrand(brand.id, patch)
        console.log(`  [OK] ${brand.slug} — enriched: ${enrichedFields.join(', ')}`)
      } catch (err) {
        console.warn(`  [ERROR] Update failed for ${brand.slug}:`, err)
      }
    } else {
      console.log(`  [OK] ${brand.slug} — no gaps to fill`)
    }

    const updatedBrand = { ...brand, ...patch }
    const ready = isShowcaseReady(updatedBrand)
    if (ready) {
      goodCount++
      console.log(`  [SHOWCASE] ${brand.slug} is showcase-ready (${goodCount}${stopAfter ? `/${stopAfter}` : ''})`)
    }

    summary.push({
      slug: brand.slug,
      fields: enrichedFields,
      images: downloadedImages.length,
      showcaseReady: ready,
    })

    if (stopAfter && goodCount >= stopAfter) {
      console.log(`\nReached ${stopAfter} showcase-ready brands — stopping early.`)
      break
    }

    await sleep(SCRAPE_DELAY_MS)
  }

  // Print summary
  console.log('\n--- Summary ---')
  console.log('Slug                          | Fields Enriched            | Images | Ready')
  console.log('------------------------------|----------------------------|--------|------')
  for (const { slug, fields, images, showcaseReady } of summary) {
    const s = slug.padEnd(30).slice(0, 30)
    const f = (fields.length > 0 ? fields.join(', ') : '(none)').padEnd(27).slice(0, 27)
    const r = showcaseReady ? 'YES' : ' - '
    console.log(`${s}| ${f}| ${String(images).padStart(6)} | ${r}`)
  }

  console.log(`\nDone. Enriched ${summary.filter((s) => s.fields.length > 0).length} of ${summary.length} brands.`)
}

// ---------------------------------------------------------------------------
// set-visibility
// ---------------------------------------------------------------------------

async function setVisibility(slugs: string[]): Promise<void> {
  if (slugs.length === 0) {
    console.log('Usage: pnpm curate set-visibility <slug1> <slug2> ...')
    console.log('Hides all brands, then approves only the listed slugs.')
    process.exit(1)
  }

  console.log(`Validating ${slugs.length} slug(s)...`)
  const { brands } = await getBrands({ limit: 1000 })
  const slugMap = new Map(brands.map((b) => [b.slug, b]))

  // Fail fast if any slug is missing
  const missing = slugs.filter((s) => !slugMap.has(s))
  if (missing.length > 0) {
    console.error(`Missing slugs: ${missing.join(', ')}`)
    process.exit(1)
  }

  // Bulk-hide all brands
  console.log('Hiding all brands...')
  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('brands')
    .update({ status: 'hidden' }, { count: 'exact' })
    .neq('status', 'hidden')

  if (error) throw error
  console.log(`  Hidden ${count ?? 0} brand(s)`)

  // Approve selected
  console.log(`Approving ${slugs.length} brand(s)...`)
  for (const slug of slugs) {
    const brand = slugMap.get(slug)!
    await updateBrand(brand.id, { status: 'approved' })
    console.log(`  [OK] ${slug}`)
  }

  console.log(`\nDone. ${slugs.length} brands are now visible.`)
}

// ---------------------------------------------------------------------------
// auto-tag
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  clothing: ['衣', '服飾', '服裝', '上衣', '褲', '裙', '外套', '洋裝', '襯衫', 'T恤', '背心', '襪'],
  footwear: ['鞋', '拖鞋', '涼鞋', '靴', '球鞋'],
  bags: ['包', '背包', '手提', '側背', '托特', '帆布袋', '皮件', '卡夾', '錢包'],
  jewelry: ['耳環', '耳夾', '項鍊', '手環', '手鍊', '戒指', '胸針', '飾品', '珠寶', '銀飾'],
  accessories: ['帽子', '圍巾', '絲巾', '眼鏡', '墨鏡', '腰帶', '領帶', '配件', '髮夾', '髮圈'],
  food: ['餅乾', '巧克力', '甜點', '零食', '糕點', '蛋糕', '食品', '醬', '麵條', '麵', '乾麵', '拌麵', '滷味'],
  beverages: ['茶', '咖啡', '茶葉', '茶包', '鮮乳', '牛奶', '乳品', '果汁', '啤酒', '酒', '飲品', '飲料'],
  agriculture: ['農', '米', '蜂蜜', '果乾', '堅果', '農產', '牧場', '養殖', '漁', '牧'],
  beauty: ['保養', '美妝', '面膜', '精華液', '乳液', '化妝', '護膚', '口紅', '彩妝'],
  'bath-body': ['洗髮', '沐浴', '香皂', '肥皂', '洗手', '護手', '清潔', '洗衣', '洗碗'],
  home: ['居家', '碗', '杯', '盤', '馬克杯', '餐具', '地墊', '掛鐘', '花瓶', '器皿', '陶', '瓷'],
  kitchen: ['刀具', '砧板', '鍋', '茶具', '廚', '鍋具', '烹飪'],
  furniture: ['家具', '桌', '椅', '燈', '沙發', '書架', '層架'],
  stationery: ['文具', '筆記本', '手帳', '貼紙', '明信片', '紙品', '筆'],
  art: ['插畫', '版畫', '攝影', '畫作', '藝術', '創作'],
  outdoor: ['戶外', '運動', '登山', '野營', '露營', '跑步', '健身', '瑜珈', '單車', '自行車'],
  tech: ['手機', '充電', '耳機', '電腦', '3C', '科技', '鍵盤'],
  pets: ['寵物', '毛孩', '貓', '狗', '貓砂', '飼料'],
  'baby-kids': ['兒童', '寶寶', '親子', '嬰兒', '嬰幼兒', '母嬰', '彌月', '玩具'],
  crafts: ['手作', '手工', '布料', '毛線', '皮革', 'DIY', '材料包'],
  fragrance: ['香氛', '蠟燭', '擴香', '精油', '線香', '香薰'],
  gardening: ['植栽', '盆栽', '花器', '園藝', '多肉'],
  experiences: ['體驗', '導覽', '工作坊', '旅遊', '觀光', '行程', '遊程'],
}

export function matchCategory(text: string): string | null {
  for (const [categorySlug, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      return categorySlug
    }
  }
  return null
}

async function autoTag(dryRun: boolean, targetSlugs?: string[]): Promise<void> {
  console.log('Fetching all brands...')
  const { brands } = await getBrands({ limit: 1000 })
  console.log(`Found ${brands.length} brands`)

  console.log('Fetching product_type tags...')
  const tags = await getTags('product_type')
  const tagBySlug = new Map(tags.map((t) => [t.slug, t]))
  console.log(`Found ${tags.length} product_type tags\n`)

  const supabase = dryRun ? null : createServiceClient()

  let untagged = brands.filter((b) => b.category === null)
  if (targetSlugs) {
    untagged = untagged.filter((b) => targetSlugs.includes(b.slug))
    console.log(`Filtering to ${untagged.length} of ${targetSlugs.length} requested slugs (others already tagged or not found)\n`)
  } else {
    console.log(`Brands without category: ${untagged.length} (skipping ${brands.length - untagged.length} already tagged)\n`)
  }

  const tally: Record<string, number> = {}
  const unmatched: string[] = []

  for (const brand of untagged) {
    const text = `${brand.name} ${brand.description ?? ''}`
    const matched = matchCategory(text)

    if (!matched) {
      unmatched.push(brand.slug)
      console.log(`  [NO MATCH] ${brand.slug}`)
      continue
    }

    const tag = tagBySlug.get(matched)
    const categoryLabel = tag?.nameZh ?? tag?.name ?? matched

    if (dryRun) {
      console.log(`  [DRY RUN] ${brand.slug} → ${matched} (${categoryLabel})`)
    } else {
      try {
        await updateBrand(brand.id, { category: categoryLabel })

        if (tag) {
          const { error } = await supabase!
            .from('brand_taxonomy')
            .upsert({ brand_id: brand.id, tag_id: tag.id }, { onConflict: 'brand_id,tag_id', ignoreDuplicates: true })

          if (error) throw error
        }

        console.log(`  [OK] ${brand.slug} → ${matched} (${categoryLabel})`)
      } catch (err) {
        console.warn(`  [ERROR] ${brand.slug}:`, err)
      }
    }

    tally[matched] = (tally[matched] ?? 0) + 1
  }

  console.log('\n--- Summary ---')
  console.log(`Brands processed: ${untagged.length}`)
  console.log(`Matched: ${untagged.length - unmatched.length}`)
  console.log(`Unmatched: ${unmatched.length}`)

  if (Object.keys(tally).length > 0) {
    console.log('\nCategories assigned:')
    for (const [slug, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${slug.padEnd(16)} ${count}`)
    }
  }

  if (unmatched.length > 0) {
    console.log('\nUnmatched brands:')
    for (const slug of unmatched) {
      console.log(`  ${slug}`)
    }
  }

  if (dryRun) {
    console.log('\nDry run — no changes made.')
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log('Usage: pnpm curate <command>')
  console.log('Commands:')
  console.log('  score-and-scrape [--dry-run] [--slugs=a,b,c] [--stop-after=N]  Score and scrape')
  console.log('  set-visibility <slug1> ...                     Hide all, approve selected')
  console.log('  auto-tag [--dry-run]                           Assign product_type categories via keyword matching')
}

async function main() {
  const command = process.argv[2]
  const args = process.argv.slice(3)

  switch (command) {
    case 'score-and-scrape': {
      const dryRun = args.includes('--dry-run')
      const slugsArg = args.find((a) => a.startsWith('--slugs='))
      const targetSlugs = slugsArg ? slugsArg.replace('--slugs=', '').split(',') : undefined
      const stopArg = args.find((a) => a.startsWith('--stop-after='))
      const stopAfter = stopArg ? parseInt(stopArg.replace('--stop-after=', ''), 10) : undefined
      await scoreAndScrape(dryRun, targetSlugs, stopAfter)
      break
    }
    case 'set-visibility': {
      await setVisibility(args)
      break
    }
    case 'auto-tag': {
      const dryRun = args.includes('--dry-run')
      const slugsArg = args.find((a) => a.startsWith('--slugs='))
      const targetSlugs = slugsArg ? slugsArg.replace('--slugs=', '').split(',') : undefined
      await autoTag(dryRun, targetSlugs)
      break
    }
    default:
      printUsage()
      process.exit(1)
  }
}

// Only run main when executed directly (not imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
