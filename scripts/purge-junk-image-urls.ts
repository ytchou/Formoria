import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isNonImageHost } from '@/lib/images/allowed-image-hosts'
import { getBrands, updateBrand } from '@/lib/services/brands'
import type { Brand } from '@/lib/types'

type BackupBrand = Pick<Brand, 'id' | 'slug' | 'heroImageUrl' | 'productPhotos'>

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

function isPurgeable(url: string): boolean {
  return isNonImageHost(url)
}

function purgeableUrls(brand: Brand): string[] {
  const urls: string[] = []

  if (brand.heroImageUrl && isPurgeable(brand.heroImageUrl)) {
    urls.push(brand.heroImageUrl)
  }

  for (const url of brand.productPhotos) {
    if (isPurgeable(url)) {
      urls.push(url)
    }
  }

  return urls
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
  let brandsAffected = 0
  let totalUrlsToPurge = 0

  for (const brand of brands) {
    const urls = purgeableUrls(brand)

    if (urls.length > 0) {
      brandsAffected++
      totalUrlsToPurge += urls.length
    }

    for (const url of urls) {
      const hostname = getHostname(url)
      hostCounts.set(hostname, (hostCounts.get(hostname) ?? 0) + 1)
    }
  }

  console.log('--- Dry Run Summary ---')
  console.log(`Approved brands scanned: ${brands.length}`)
  console.log(`Brands affected: ${brandsAffected}`)
  console.log(`Total URLs to purge: ${totalUrlsToPurge}`)

  console.log('\nHost histogram:')
  const sortedHosts = [...hostCounts.entries()].sort((a, b) => b[1] - a[1])
  if (sortedHosts.length === 0) {
    console.log('  (none)')
  } else {
    for (const [hostname, count] of sortedHosts) {
      console.log(`  ${hostname.padEnd(40)} ${count}`)
    }
  }

  console.log('\nDry run complete. No changes made.')
}

function backupPath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join('scripts', `.purge-backup-${timestamp}.json`)
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

    console.log(`[${i + 1}/${backup.length}] ${brand.slug} — restored original values`)
  }

  console.log(`Restored ${restored} brand(s) from ${restorePath}`)
  console.log(`Failed: ${failed}`)
}

async function runPurge(slug: string | null): Promise<void> {
  const brands = await getTargetBrands(slug)
  const outputPath = await writeBackup(brands)

  console.log(`Backup written before mutation: ${outputPath}`)
  console.log(`Purging junk image URLs from ${brands.length} brand(s) sequentially...`)

  let brandsPurged = 0
  let urlsPurged = 0
  let failed = 0

  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i]
    const urls = purgeableUrls(brand)

    if (urls.length === 0) {
      console.log(`[${i + 1}/${brands.length}] ${brand.slug} — no purgeable URLs`)
      continue
    }

    try {
      await updateBrand(brand.id, {
        heroImageUrl:
          brand.heroImageUrl && isPurgeable(brand.heroImageUrl)
            ? null
            : brand.heroImageUrl,
        productPhotos: brand.productPhotos.filter((url) => !isPurgeable(url)),
      })
      brandsPurged++
      urlsPurged += urls.length
      console.log(`[${i + 1}/${brands.length}] ${brand.slug} — purged ${urls.length} URLs`)
    } catch (err) {
      failed++
      console.error(`${brand.slug}:`, err)
      console.log(`[${i + 1}/${brands.length}] ${brand.slug} — failed`)
    }
  }

  console.log('\n--- Purge Summary ---')
  console.log(`Brands processed: ${brands.length}`)
  console.log(`Brands purged: ${brandsPurged}`)
  console.log(`URLs purged: ${urlsPurged}`)
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
