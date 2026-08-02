/**
 * Benchmarks this worktree's curation pipeline against live production data,
 * by running the REAL worker entry point — `runEnrich` — rather than a
 * reimplementation of it.
 *
 * Note the scratch submissions carry no product category: `brand_submissions`
 * has no such column, so `detect` assigns one exactly as it would for a real
 * submission. That is more faithful than copying the live value across.
 *
 * Live `brands` / `brand_images` are never touched. Six temporary
 * `brand_submissions` rows are created from the tracked brands, the worker runs
 * against those, results land in `submission_images`, and the temporary rows are
 * deleted afterwards in a finally block so an aborted run still cleans up.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/image-eval/bench-worker.ts
 */
import { writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { runEnrich } from '@/lib/services/curation-operations'

const TRACKED_SLUGS = [
  'jiayun-store',
  'venturezac',
  'handmadeship',
  'yuanxing-theoriental',
  'major-pleasure',
  'nu-dream-jewelry',
]

/**
 * Cleanup matches on the email, NOT on a name prefix. An earlier version
 * prefixed `brand_name` to make the rows obvious in the admin queue, and that
 * prefix flowed straight into the SERP and image queries — `site:host [BENCH]
 * Brand` found nothing. The benchmark has to send the brand's real name.
 */
const SCRATCH_EMAIL = 'bench+dev1279@formoria.com'

/** The phases under test: everything from SERP through classification. */
const PHASES = ['discover', 'detect', 'clean', 'links', 'images', 'classify_images']

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
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: brands, error } = await supabase
    .from('brands')
    .select(
      'id, slug, name, product_type, description, purchase_website, social_instagram, social_threads, social_facebook, purchase_pinkoi, purchase_shopee'
    )
    .in('slug', TRACKED_SLUGS)
  if (error) throw error
  const rows = (brands ?? []) as BrandRow[]
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
    console.log(`\nrunning runEnrich over ${createdIds.length} submissions — phases: ${PHASES.join(', ')}\n`)
    const result = await runEnrich(
      {
        target: 'submissions',
        submissionIds: createdIds,
        phases: PHASES,
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
          'id, brand_name, product_type_note, purchase_website, social_instagram, social_threads, social_facebook, purchase_pinkoi, purchase_shopee, enriched_data'
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

    await writeFile(
      'scripts/image-eval/runs/_track/worker-after.json',
      JSON.stringify({ ranAt: new Date().toISOString(), phases: PHASES, brands: captured }, null, 2)
    )
    console.log('\nwrote scripts/image-eval/runs/_track/worker-after.json')
  } finally {
    // --- cleanup, even if the run threw ---
    if (createdIds.length > 0) {
      const { error: imageError } = await supabase
        .from('submission_images')
        .delete()
        .in('submission_id', createdIds)
      if (imageError) console.error(`  cleanup: submission_images — ${imageError.message}`)
      const { error: subError } = await supabase
        .from('brand_submissions')
        .delete()
        .in('id', createdIds)
      if (subError) console.error(`  cleanup: brand_submissions — ${subError.message}`)
      console.log(`cleaned up ${createdIds.length} scratch submission(s)`)

      const { data: leftovers } = await supabase
        .from('brand_submissions')
        .select('id')
        .eq('submitter_email', SCRATCH_EMAIL)
      if ((leftovers ?? []).length > 0) {
        console.error(`  WARNING: ${(leftovers ?? []).length} scratch row(s) remain — delete by submitter_email ${SCRATCH_EMAIL}`)
      }
    }
  }
}

void main().catch((e) => {
  console.error('\nFAILED:', e instanceof Error ? e.message : JSON.stringify(e))
  process.exitCode = 1
})

export {}
