import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Brand } from '@/lib/types'
import {
  collectSyncableImageUrls,
  getBrands,
  syncBrandImages,
  updateBrand,
} from '@/lib/services/brands'
import { isNonImageHost } from '@/lib/images/allowed-image-hosts'

type BackupBrand = Pick<Brand, 'id' | 'heroImageUrl' | 'productPhotos'> & {
  slug?: string
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

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return '(invalid-url)'
  }
}

async function dryRun(slug: string | null): Promise<void> {
  const brands = await getTargetBrands(slug)
  const hostCounts = new Map<string, number>()
  const flaggedHeroBrands: { slug: string; heroImageUrl: string }[] = []
  let brandsWithSyncableUrls = 0
  let totalSyncableImages = 0

  for (const brand of brands) {
    const syncableUrls = collectSyncableImageUrls({
      heroImageUrl: brand.heroImageUrl,
      productPhotos: brand.productPhotos,
    })

    if (syncableUrls.length > 0) {
      brandsWithSyncableUrls++
      totalSyncableImages += syncableUrls.length
    }

    for (const url of syncableUrls) {
      const hostname = getHostname(url)
      hostCounts.set(hostname, (hostCounts.get(hostname) ?? 0) + 1)
    }

    if (brand.heroImageUrl && isNonImageHost(brand.heroImageUrl)) {
      flaggedHeroBrands.push({
        slug: brand.slug,
        heroImageUrl: brand.heroImageUrl,
      })
    }
  }

  console.log('--- Dry Run Summary ---')
  console.log(`Approved brands scanned: ${brands.length}`)
  console.log(`Brands with syncable URLs: ${brandsWithSyncableUrls}`)
  console.log(`Total syncable images: ${totalSyncableImages}`)

  console.log('\nHost histogram:')
  const sortedHosts = [...hostCounts.entries()].sort((a, b) => b[1] - a[1])
  if (sortedHosts.length === 0) {
    console.log('  (none)')
  } else {
    for (const [hostname, count] of sortedHosts) {
      console.log(`  ${hostname.padEnd(40)} ${count}`)
    }
  }

  console.log('\nBrands with non-image hero URLs:')
  if (flaggedHeroBrands.length === 0) {
    console.log('  (none)')
  } else {
    for (const brand of flaggedHeroBrands) {
      console.log(`  ${brand.slug}: ${brand.heroImageUrl}`)
    }
  }

  console.log('\nDry run complete. No changes made.')
}

function backupPath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join('scripts', `.backfill-backup-${timestamp}.json`)
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
      heroImageUrl,
      productPhotos: record.productPhotos,
    }
  })
}

async function restoreBackup(restorePath: string): Promise<void> {
  const backup = parseBackupJson(await readFile(restorePath, 'utf8'))
  let restored = 0

  for (const brand of backup) {
    await updateBrand(brand.id, {
      heroImageUrl: brand.heroImageUrl,
      productPhotos: brand.productPhotos,
    })
    restored++
  }

  console.log(`Restored ${restored} brand(s) from ${restorePath}`)
}

async function runBackfill(slug: string | null): Promise<void> {
  const brands = await getTargetBrands(slug)
  const outputPath = await writeBackup(brands)

  console.log(`Backup written before mutation: ${outputPath}`)
  console.log(`Syncing ${brands.length} brand(s) sequentially...`)

  let synced = 0
  let failed = 0

  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i]

    try {
      await syncBrandImages(brand.id)
      synced++
    } catch (err) {
      failed++
      console.error(`${brand.slug}:`, err)
    }

    const processed = i + 1
    if (processed % 10 === 0 || processed === brands.length) {
      console.log(`Progress: ${processed}/${brands.length}`)
    }
  }

  console.log('\n--- Backfill Summary ---')
  console.log(`Total: ${brands.length}`)
  console.log(`Synced: ${synced}`)
  console.log(`Failed: ${failed}`)
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

  await runBackfill(options.slug)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
