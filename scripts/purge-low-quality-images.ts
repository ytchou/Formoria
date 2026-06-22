import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { getBrands, updateBrand } from '@/lib/services/brands'
import type { Brand } from '@/lib/types'

const MIN_IMAGE_SIZE_BYTES = 5_120
const MIN_IMAGE_DIMENSION_PX = 400
const FETCH_TIMEOUT_MS = 10_000
const CONCURRENCY = 5

type BackupBrand = Pick<Brand, 'id' | 'slug' | 'heroImageUrl' | 'productPhotos'>

type FailedImage = {
  brandSlug: string
  url: string
  reason: string
}

type CliOptions = {
  dryRun: boolean
  slug: string | null
  restorePath: string | null
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    slug: null,
    restorePath: null,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--slug') {
      options.slug = argv[i + 1] ?? null
      i++
    } else if (arg.startsWith('--slug=')) {
      options.slug = arg.slice('--slug='.length)
    } else if (arg === '--restore') {
      options.restorePath = argv[i + 1] ?? null
      i++
    } else if (arg.startsWith('--restore=')) {
      options.restorePath = arg.slice('--restore='.length)
    } else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(1)
    }
  }

  if (options.slug === '') {
    console.error('--slug requires a value')
    process.exit(1)
  }

  if (options.restorePath === '') {
    console.error('--restore requires a path')
    process.exit(1)
  }

  return options
}

async function getTargetBrands(slug: string | null): Promise<Brand[]> {
  const { brands } = await getBrands({ status: 'approved', limit: 10000 })

  if (!slug) {
    return brands
  }

  const brand = brands.find((candidate) => candidate.slug === slug)
  if (!brand) {
    console.error(`Approved brand not found for slug: ${slug}`)
    process.exit(1)
  }

  return [brand]
}

async function checkImage(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) return `fetch failed (${response.status})`

    const blob = await response.blob()

    if (blob.size < MIN_IMAGE_SIZE_BYTES) {
      return `too small (${blob.size} bytes)`
    }

    const buffer = Buffer.from(await blob.arrayBuffer())
    const { width, height } = await sharp(buffer).metadata()

    if (
      !width ||
      !height ||
      Math.min(width, height) < MIN_IMAGE_DIMENSION_PX
    ) {
      return `low resolution (${width ?? 0}x${height ?? 0})`
    }

    return null
  } catch (err) {
    clearTimeout(timeoutId)
    const message = err instanceof Error ? err.message : String(err)
    return `error: ${message}`
  }
}

async function checkBrandImages(
  brand: Brand
): Promise<{ heroFailed: string | null; failedPhotos: Map<string, string> }> {
  let heroFailed: string | null = null
  const failedPhotos = new Map<string, string>()

  if (brand.heroImageUrl) {
    const reason = await checkImage(brand.heroImageUrl)
    if (reason) heroFailed = reason
  }

  for (let i = 0; i < brand.productPhotos.length; i += CONCURRENCY) {
    const batch = brand.productPhotos.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map((url) => checkImage(url)))
    for (let j = 0; j < batch.length; j++) {
      if (results[j]) {
        failedPhotos.set(batch[j], results[j]!)
      }
    }
  }

  return { heroFailed, failedPhotos }
}

async function dryRun(slug: string | null): Promise<void> {
  const brands = await getTargetBrands(slug)
  let brandsAffected = 0
  let totalUrlsToRemove = 0
  let heroRemovals = 0
  const allFailed: FailedImage[] = []
  const reasonCounts = new Map<string, number>()

  console.log(`Scanning ${brands.length} brand(s)...\n`)

  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i]
    const imageCount =
      brand.productPhotos.length + (brand.heroImageUrl ? 1 : 0)

    if (imageCount === 0) continue

    const { heroFailed, failedPhotos } = await checkBrandImages(brand)
    const failCount = failedPhotos.size + (heroFailed ? 1 : 0)

    if (failCount > 0) {
      brandsAffected++
      totalUrlsToRemove += failCount

      if (heroFailed) {
        heroRemovals++
        allFailed.push({
          brandSlug: brand.slug,
          url: brand.heroImageUrl!,
          reason: heroFailed,
        })
        const key = heroFailed.startsWith('low resolution')
          ? 'low resolution'
          : heroFailed.startsWith('too small')
            ? 'too small'
            : 'other'
        reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1)
      }

      for (const [url, reason] of failedPhotos) {
        allFailed.push({ brandSlug: brand.slug, url, reason })
        const key = reason.startsWith('low resolution')
          ? 'low resolution'
          : reason.startsWith('too small')
            ? 'too small'
            : 'other'
        reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1)
      }

      console.log(
        `[${i + 1}/${brands.length}] ${brand.slug} — ${failCount} low-quality image(s)`
      )
    } else if ((i + 1) % 50 === 0) {
      console.log(`[${i + 1}/${brands.length}] scanning...`)
    }
  }

  console.log('\n--- Dry Run Summary ---')
  console.log(`Brands scanned: ${brands.length}`)
  console.log(`Brands affected: ${brandsAffected}`)
  console.log(`Total images to remove: ${totalUrlsToRemove}`)
  console.log(`  Hero images: ${heroRemovals}`)
  console.log(`  Product photos: ${totalUrlsToRemove - heroRemovals}`)

  console.log('\nBy reason:')
  for (const [reason, count] of [...reasonCounts.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${reason.padEnd(20)} ${count}`)
  }

  if (allFailed.length > 0) {
    console.log('\nFlagged images:')
    for (const { brandSlug, url, reason } of allFailed) {
      const shortUrl = url.length > 80 ? `${url.slice(0, 77)}...` : url
      console.log(`  ${brandSlug.padEnd(30)} ${reason.padEnd(25)} ${shortUrl}`)
    }
  }

  console.log('\nDry run complete. No changes made.')
}

function backupPath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join('scripts', `.quality-purge-backup-${timestamp}.json`)
}

async function writeBackup(brands: Brand[]): Promise<string> {
  const backup: BackupBrand[] = brands.map((brand) => ({
    id: brand.id,
    slug: brand.slug,
    heroImageUrl: brand.heroImageUrl,
    productPhotos: brand.productPhotos,
  }))
  const outputPath = backupPath()
  await writeFile(outputPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
  return outputPath
}

function parseBackupJson(raw: string): BackupBrand[] {
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Backup file must contain an array')
  }

  return parsed.map((item, index) => {
    const record = item as Record<string, unknown>
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof record.id !== 'string' ||
      typeof record.slug !== 'string' ||
      !Array.isArray(record.productPhotos)
    ) {
      throw new Error(`Invalid backup entry at index ${index}`)
    }

    const heroImageUrl = record.heroImageUrl ?? null
    if (heroImageUrl !== null && typeof heroImageUrl !== 'string') {
      throw new Error(`Invalid heroImageUrl at index ${index}`)
    }
    if (!record.productPhotos.every((url) => typeof url === 'string')) {
      throw new Error(`Invalid productPhotos at index ${index}`)
    }

    return {
      id: record.id,
      slug: record.slug,
      heroImageUrl,
      productPhotos: record.productPhotos,
    }
  })
}

async function restoreBackup(restorePath: string): Promise<void> {
  const backup = parseBackupJson(await readFile(restorePath, 'utf8'))
  let restored = 0
  let failed = 0

  for (let i = 0; i < backup.length; i++) {
    const brand = backup[i]

    try {
      await updateBrand(brand.id, {
        heroImageUrl: brand.heroImageUrl,
        productPhotos: brand.productPhotos,
      })
      restored++
    } catch (err) {
      failed++
      console.error(`${brand.slug}:`, err)
    }

    console.log(
      `[${i + 1}/${backup.length}] ${brand.slug} — restored original values`
    )
  }

  console.log(`Restored ${restored} brand(s) from ${restorePath}`)
  console.log(`Failed: ${failed}`)
}

async function runPurge(slug: string | null): Promise<void> {
  const brands = await getTargetBrands(slug)
  const outputPath = await writeBackup(brands)

  console.log(`Backup written before mutation: ${outputPath}`)
  console.log(
    `Purging low-quality images from ${brands.length} brand(s) sequentially...`
  )

  let brandsPurged = 0
  let urlsPurged = 0
  let failed = 0

  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i]
    const imageCount =
      brand.productPhotos.length + (brand.heroImageUrl ? 1 : 0)

    if (imageCount === 0) {
      console.log(`[${i + 1}/${brands.length}] ${brand.slug} — no images`)
      continue
    }

    try {
      const { heroFailed, failedPhotos } = await checkBrandImages(brand)
      const failCount = failedPhotos.size + (heroFailed ? 1 : 0)

      if (failCount === 0) {
        console.log(
          `[${i + 1}/${brands.length}] ${brand.slug} — all images OK`
        )
        continue
      }

      await updateBrand(brand.id, {
        heroImageUrl: heroFailed ? null : brand.heroImageUrl,
        productPhotos: brand.productPhotos.filter(
          (url) => !failedPhotos.has(url)
        ),
      })

      brandsPurged++
      urlsPurged += failCount
      console.log(
        `[${i + 1}/${brands.length}] ${brand.slug} — removed ${failCount} image(s)`
      )
    } catch (err) {
      failed++
      console.error(`${brand.slug}:`, err)
      console.log(`[${i + 1}/${brands.length}] ${brand.slug} — failed`)
    }
  }

  console.log('\n--- Purge Summary ---')
  console.log(`Brands processed: ${brands.length}`)
  console.log(`Brands purged: ${brandsPurged}`)
  console.log(`Images removed: ${urlsPurged}`)
  console.log(`Failures: ${failed}`)
  console.log(`Backup path: ${outputPath}`)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  if (options.restorePath) {
    await restoreBackup(options.restorePath)
    return
  }

  if (options.dryRun) {
    await dryRun(options.slug)
    return
  }

  await runPurge(options.slug)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
