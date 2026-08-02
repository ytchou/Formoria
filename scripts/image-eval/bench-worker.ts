/**
 * Benchmarks this worktree's curation pipeline against live production data,
 * by running the REAL worker entry point — `runEnrich` — rather than a
 * reimplementation of it.
 *
 * Note the scratch submissions carry no product category: `brand_submissions`
 * has no such column, so `detect` assigns one exactly as it would for a real
 * submission. That is more faithful than copying the live value across.
 *
 * Live `brands` / `brand_images` are never touched. One temporary
 * `brand_submissions` row per brand is created from the tracked brands, the
 * worker runs against those, results land in `submission_images`, and the
 * temporary rows are deleted afterwards in a finally block so an aborted run
 * still cleans up.
 *
 *   # all tracked brands -> runs/_track/worker-after.json
 *   pnpm exec tsx --env-file=.env.local scripts/image-eval/bench-worker.ts
 *
 *   # a subset, to its own file (never overwrite a run you still want)
 *   pnpm exec tsx --env-file=.env.local scripts/image-eval/bench-worker.ts \
 *     --slugs venturezac,handmadeship --out runs/_track/worker-after-subset.json
 *
 * `--out` is resolved under `scripts/image-eval/` and refuses to clobber an
 * existing file: a benchmark that silently overwrites its own previous result
 * destroys the only copy of the comparison you were about to make.
 */
import { writeFile, mkdir, access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { runEnrich } from '@/lib/services/curation-operations'

const ALL_TRACKED_SLUGS = [
  'jiayun-store',
  'venturezac',
  'handmadeship',
  'yuanxing-theoriental',
  'major-pleasure',
  'nu-dream-jewelry',
]

const EVAL_ROOT = 'scripts/image-eval'
const DEFAULT_OUT = 'runs/_track/worker-after.json'

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv.at(index + 1)
}

function parseArgs(): { slugs: string[]; outPath: string } {
  const rawSlugs = argValue('--slugs')
  const slugs = rawSlugs
    ? rawSlugs.split(',').map((s) => s.trim()).filter(Boolean)
    : ALL_TRACKED_SLUGS
  const unknown = slugs.filter((s) => !ALL_TRACKED_SLUGS.includes(s))
  if (unknown.length > 0) {
    throw new Error(
      `unknown slug(s): ${unknown.join(', ')}\n  tracked: ${ALL_TRACKED_SLUGS.join(', ')}`
    )
  }
  return { slugs, outPath: resolve(EVAL_ROOT, argValue('--out') ?? DEFAULT_OUT) }
}

async function assertNotClobbering(outPath: string): Promise<void> {
  try {
    await access(outPath)
  } catch {
    return
  }
  throw new Error(`refusing to overwrite existing ${outPath} — pass a different --out`)
}

/**
 * Cleanup matches on the email, NOT on a name prefix. An earlier version
 * prefixed `brand_name` to make the rows obvious in the admin queue, and that
 * prefix flowed straight into the SERP and image queries — `site:host [BENCH]
 * Brand` found nothing. The benchmark has to send the brand's real name.
 */
const SCRATCH_EMAIL = 'bench+dev1279@formoria.com'

/**
 * All three steps. Selecting steps rather than phases is the point of the new
 * API — an operator never names a phase, and this benchmark should exercise the
 * same surface an operator uses.
 */
const STEPS = ['context', 'image', 'detail'] as const

type BrandRow = {
  id: string
  slug: string
  name: string
  product_type: string | null
  description: string | null
  purchase_website: string | null
  social_instagram: string | null
  social_threads: string | null
  social_facebook: string | null
  purchase_pinkoi: string | null
  purchase_shopee: string | null
}

async function main(): Promise<void> {
  const { slugs, outPath } = parseArgs()
  // Checked before any row is written, so a bad --out fails free rather than
  // after a full run against live services.
  await assertNotClobbering(outPath)
  console.log(`brands: ${slugs.join(', ')}`)
  console.log(`output: ${outPath}\n`)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: brands, error } = await supabase
    .from('brands')
    .select(
      'id, slug, name, product_type, description, purchase_website, social_instagram, social_threads, social_facebook, purchase_pinkoi, purchase_shopee'
    )
    .in('slug', slugs)
  if (error) throw error
  const rows = (brands ?? []) as BrandRow[]
  if (rows.length !== slugs.length) {
    const found = new Set(rows.map((r) => r.slug))
    throw new Error(`missing live brand(s): ${slugs.filter((s) => !found.has(s)).join(', ')}`)
  }
  console.log(`loaded ${rows.length} live brands`)

  const createdIds: string[] = []

  try {
    // --- create the scratch submissions ---
    for (const b of rows) {
      const { data, error: insertError } = await supabase
        .from('brand_submissions')
        .insert({
          brand_name: b.name,
          submitter_email: SCRATCH_EMAIL,
          status: 'pending',
          intent: 'recommend',
          description: b.description,
          website_url: b.purchase_website,
          purchase_website: b.purchase_website,
          social_instagram: b.social_instagram,
          social_threads: b.social_threads,
          social_facebook: b.social_facebook,
          purchase_pinkoi: b.purchase_pinkoi,
          purchase_shopee: b.purchase_shopee,
          other_urls: [],
        })
        .select('id')
        .single()
      if (insertError) throw new Error(`insert failed: ${JSON.stringify(insertError)}`)
      createdIds.push((data as { id: string }).id)
      console.log(`  scratch submission for ${b.slug}: ${(data as { id: string }).id}`)
    }

    // --- run the real worker ---
    console.log(`\nrunning runEnrich over ${createdIds.length} submissions — steps: ${STEPS.join(', ')}\n`)
    const result = await runEnrich(
      {
        target: 'submissions',
        submissionIds: createdIds,
        steps: [...STEPS],
        overwrite: true,
        onProgress: (line: string) => console.log(line),
      } as never,
      supabase as never
    )
    console.log(
      `\nrunEnrich done — processed ${result.processed}, updated ${result.updated}, skipped ${result.skipped}, errors ${result.errors.length}`
    )

    // --- capture what it produced, before cleanup removes it ---
    const captured: unknown[] = []
    for (const [index, submissionId] of createdIds.entries()) {
      const brand = rows[index]
      if (!brand) continue
      const { data: sub } = await supabase
        .from('brand_submissions')
        .select(
          '*'
        )
        .eq('id', submissionId)
        .single()
      const { data: imgs } = await supabase
        .from('submission_images')
        .select(
          'url, source, provider_metadata, source_url, status, score, tags, width, height, sort_order, alt_zh, rejection_reasons'
        )
        .eq('submission_id', submissionId)
      captured.push({ slug: brand.slug, liveName: brand.name, submission: sub, images: imgs ?? [] })
      console.log(
        `  ${brand.slug.padEnd(22)} ${(imgs ?? []).filter((i) => (i as { status: string }).status === 'active').length} active / ${(imgs ?? []).length} total`
      )
    }

    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(
      outPath,
      JSON.stringify({ ranAt: new Date().toISOString(), steps: [...STEPS], brands: captured }, null, 2)
    )
    console.log(`\nwrote ${outPath}`)
  } finally {
    // Cleanup must be loud. A previous run reported "cleaned up" and left all six
    // rows in production: the deletes returned no error and affected nothing, so
    // the only signal was a warning nobody would have acted on. Deletes now use
    // `.select()` to report the rows they actually removed, and a leftover check
    // throws rather than warns.
    if (createdIds.length > 0) {
      const { data: deletedImages, error: imageError } = await supabase
        .from('submission_images')
        .delete()
        .in('submission_id', createdIds)
        .select('id')
      if (imageError) console.error(`  cleanup: submission_images — ${imageError.message}`)
      console.log(`  deleted ${(deletedImages ?? []).length} scratch image row(s)`)

      const { data: deletedSubs, error: subError } = await supabase
        .from('brand_submissions')
        .delete()
        .in('id', createdIds)
        .select('id')
      if (subError) console.error(`  cleanup: brand_submissions — ${subError.message}`)
      console.log(`  deleted ${(deletedSubs ?? []).length} of ${createdIds.length} scratch submission(s)`)

      const { data: leftovers } = await supabase
        .from('brand_submissions')
        .select('id')
        .eq('submitter_email', SCRATCH_EMAIL)
      const remaining = (leftovers ?? []).length
      if (remaining > 0) {
        throw new Error(
          `CLEANUP FAILED: ${remaining} scratch submission(s) still in production. ` +
            `Remove them with:\n` +
            `  delete from brand_submissions where submitter_email = '${SCRATCH_EMAIL}';`
        )
      }
      console.log('  cleanup verified: no scratch rows remain')
    }
  }
}

void main().catch((e) => {
  console.error('\nFAILED:', e instanceof Error ? e.message : JSON.stringify(e))
  process.exitCode = 1
})

export {}
