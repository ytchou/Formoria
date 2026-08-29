#!/usr/bin/env tsx
/**
 * One-shot idempotent seed script: generates synthetic `curation_job_targets`
 * history for brand submissions that predate the job-targets system.
 *
 * The history-based satisfaction checker treats existing enrichment as
 * "already done" once a matching phase_results row exists. Without this
 * backfill, every pre-existing brand would be re-enriched on its next run.
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-phase-history.ts
 *   pnpm exec tsx scripts/seed-phase-history.ts --dry-run
 */

import { createServiceClient } from '@/lib/supabase/service'
import { type EnrichPhaseName } from '@/lib/constants/enrich-phases'
import type { PhaseResult } from '@/lib/types/curation'
import type { Json } from '@/lib/supabase/database.types'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const dryRun = process.argv.includes('--dry-run')

// ---------------------------------------------------------------------------
// Types for the joined query rows
// ---------------------------------------------------------------------------

type SubmissionRow = {
  id: string
  brand_id: string | null
  brand_name: string
  purchase_website: string | null
  website_url: string | null
  enriched_data: Json | null
  brands: {
    id: string
    description: string | null
    purchase_website: string | null
  } | null
}

// ---------------------------------------------------------------------------
// Phase predicates — mirror the OLD column-based PREDICATES that were deleted
// when the history-based satisfaction checker was introduced.
// ---------------------------------------------------------------------------

/** Phases that had real predicates in the old system. */
const SEEDABLE_PHASES: readonly EnrichPhaseName[] = [
  'links',
  'images',
  'products',
  'descriptions',
  'reputation',
  'tags',
  'faq',
  'stockists',
] as const

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function isNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function enrichedJson(row: SubmissionRow): Record<string, unknown> {
  if (row.enriched_data && typeof row.enriched_data === 'object' && !Array.isArray(row.enriched_data)) {
    return row.enriched_data as Record<string, unknown>
  }
  return {}
}

function inferPhaseStatus(
  phase: EnrichPhaseName,
  row: SubmissionRow,
  imageCount: number,
  faqCount: number,
  stockistCountMap: Map<string, number>,
): 'succeeded' | null {
  switch (phase) {
    case 'links':
      // Old predicate: purchase_website || website
      return isNonEmptyString(row.purchase_website) ||
        isNonEmptyString(row.website_url) ||
        isNonEmptyString(row.brands?.purchase_website)
        ? 'succeeded'
        : null

    case 'images':
      return imageCount > 0 ? 'succeeded' : null

    case 'products':
      return isNonEmptyArray(enrichedJson(row).products) ? 'succeeded' : null

    case 'descriptions':
      // Old predicate: brand.description is truthy
      return isNonEmptyString(row.brands?.description) ? 'succeeded' : null

    case 'reputation':
      return enrichedJson(row).reputation_summary ? 'succeeded' : null

    case 'tags':
      // DB key is `category` (mapped to categorySlug in TS)
      return isNonEmptyString(enrichedJson(row).category) ? 'succeeded' : null

    case 'faq':
      // FAQ writes to brand_faq_entries, not enriched_data
      return faqCount > 0 ? 'succeeded' : null

    case 'stockists':
      return stockistCountMap.get(row.brand_id ?? '') ? 'succeeded' : null

    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const supabase = createServiceClient()

  console.log(`seed-phase-history: ${dryRun ? 'DRY RUN' : 'APPLY'} mode`)

  // Step 1: Find submission IDs that already have curation_job_targets rows
  const PAGE_SIZE = 500
  let allExistingTargets: { target_id: string }[] = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('curation_job_targets')
      .select('target_id')
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) {
      throw new Error(`Failed to query existing targets: ${error.message}`)
    }
    allExistingTargets = allExistingTargets.concat(data ?? [])
    if (!data || data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  const coveredIds = new Set(allExistingTargets.map((row) => row.target_id))

  // Step 2: Get all brand_submissions with joined brand data
  let allSubmissions: SubmissionRow[] = []
  offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('brand_submissions')
      .select(`
        id,
        brand_id,
        brand_name,
        purchase_website,
        website_url,
        enriched_data,
        brands!brand_submissions_brand_id_fkey (
          id,
          description,
          purchase_website
        )
      `)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) {
      throw new Error(`Failed to query submissions: ${error.message}`)
    }
    allSubmissions = allSubmissions.concat((data as unknown as SubmissionRow[]) ?? [])
    if (!data || data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  // Filter to only submissions WITHOUT existing target rows (idempotency)
  const uncovered = allSubmissions.filter(
    (row) => !coveredIds.has(row.id),
  )

  if (uncovered.length === 0) {
    console.log('All submissions already have curation_job_targets rows. Nothing to seed.')
    return
  }

  console.log(`Found ${uncovered.length} submissions without job-target history`)

  // Step 3: Batch-fetch image counts per brand
  const brandIds = [...new Set(uncovered.map((row) => row.brand_id).filter(Boolean))] as string[]

  const imageCountMap = new Map<string, number>()
  // Supabase IN filter has a size limit; chunk it
  const CHUNK_SIZE = 200
  for (let i = 0; i < brandIds.length; i += CHUNK_SIZE) {
    const chunk = brandIds.slice(i, i + CHUNK_SIZE)
    let imgOffset = 0
    while (true) {
      const { data, error: imageError } = await supabase
        .from('brand_images')
        .select('brand_id')
        .in('brand_id', chunk)
        .range(imgOffset, imgOffset + PAGE_SIZE - 1)

      if (imageError) {
        throw new Error(`Failed to query brand_images: ${imageError.message}`)
      }

      for (const row of data ?? []) {
        imageCountMap.set(row.brand_id, (imageCountMap.get(row.brand_id) ?? 0) + 1)
      }

      if (!data || data.length < PAGE_SIZE) break
      imgOffset += PAGE_SIZE
    }
  }

  // Step 4: Batch-fetch FAQ counts per brand
  const faqCountMap = new Map<string, number>()
  for (let i = 0; i < brandIds.length; i += CHUNK_SIZE) {
    const chunk = brandIds.slice(i, i + CHUNK_SIZE)
    let faqOffset = 0
    while (true) {
      const { data, error: faqError } = await supabase
        .from('brand_faq_entries')
        .select('brand_id')
        .in('brand_id', chunk)
        .range(faqOffset, faqOffset + PAGE_SIZE - 1)

      if (faqError) {
        throw new Error(`Failed to query brand_faq_entries: ${faqError.message}`)
      }

      for (const row of data ?? []) {
        faqCountMap.set(row.brand_id, (faqCountMap.get(row.brand_id) ?? 0) + 1)
      }

      if (!data || data.length < PAGE_SIZE) break
      faqOffset += PAGE_SIZE
    }
  }

  // Step 4b: Count enriched stockists per brand
  const stockistCountMap = new Map<string, number>()
  for (let i = 0; i < brandIds.length; i += CHUNK_SIZE) {
    const chunk = brandIds.slice(i, i + CHUNK_SIZE)
    let stockistOffset = 0
    while (true) {
      const { data, error: stockistError } = await supabase
        .from('brand_channels')
        .select('brand_id')
        .in('brand_id', chunk)
        .eq('source', 'enriched')
        .not('name', 'is', null)
        .range(stockistOffset, stockistOffset + PAGE_SIZE - 1)

      if (stockistError) {
        throw new Error(`Failed to query brand_channels: ${stockistError.message}`)
      }

      for (const row of data ?? []) {
        stockistCountMap.set(row.brand_id, (stockistCountMap.get(row.brand_id) ?? 0) + 1)
      }

      if (!data || data.length < PAGE_SIZE) break
      stockistOffset += PAGE_SIZE
    }
  }

  // Step 5: Build phase results for each submission
  type TargetInsert = {
    job_id: string
    target_id: string
    target_type: string
    brand_name: string
    brand_slug: string | null
    status: string
    phase_results: Json
    started_at: string
    completed_at: string
  }

  const now = new Date().toISOString()
  const targetRows: TargetInsert[] = []

  for (const row of uncovered) {
    const brandId = row.brand_id
    const imageCount = brandId ? (imageCountMap.get(brandId) ?? 0) : 0
    const faqCount = brandId ? (faqCountMap.get(brandId) ?? 0) : 0

    const phaseResults: PhaseResult[] = []

    for (const phase of SEEDABLE_PHASES) {
      const status = inferPhaseStatus(phase, row, imageCount, faqCount, stockistCountMap)
      if (status) {
        phaseResults.push({
          phase,
          status,
          changedFields: [],
          durationMs: 0,
        })
      }
    }

    if (phaseResults.length === 0) {
      // No phases succeeded — nothing to seed for this submission
      continue
    }

    targetRows.push({
      job_id: '', // placeholder, filled after job insert
      target_id: row.id,
      target_type: 'submission',
      brand_name: row.brand_name,
      brand_slug: null,
      status: 'succeeded',
      phase_results: phaseResults as unknown as Json,
      started_at: now,
      completed_at: now,
    })
  }

  console.log(`${targetRows.length} submissions have inferrable phase history`)

  if (targetRows.length === 0) {
    console.log('No submissions need seeding.')
    return
  }

  if (dryRun) {
    // Log a summary per submission
    for (const target of targetRows) {
      const phases = (target.phase_results as unknown as PhaseResult[])
        .map((pr) => pr.phase)
        .join(', ')
      console.log(`  [dry-run] ${target.brand_name}: ${phases}`)
    }
    console.log(`\nDry run complete. Would seed ${targetRows.length} target rows.`)
    return
  }

  // Step 6: Create ONE synthetic curation_jobs row
  const { data: job, error: jobError } = await supabase
    .from('curation_jobs')
    .insert({
      operation: 'enrich',
      status: 'completed',
      started_by: 'seed-script',
      params: { synthetic: true, task: 'seed' } as unknown as Json,
      dry_run: false,
      started_at: now,
      completed_at: now,
      target_total: targetRows.length,
      succeeded_count: targetRows.length,
      trigger: 'manual_rerun',
      dispatch_status: 'dispatched',
    })
    .select('id')
    .single()

  if (jobError || !job) {
    throw new Error(`Failed to create synthetic job: ${jobError?.message ?? 'no data'}`)
  }

  console.log(`Created synthetic job: ${job.id}`)

  // Step 7: Insert target rows in batches
  const INSERT_BATCH_SIZE = 500
  const filledTargets = targetRows.map((row) => ({ ...row, job_id: job.id }))

  let inserted = 0
  for (let i = 0; i < filledTargets.length; i += INSERT_BATCH_SIZE) {
    const batch = filledTargets.slice(i, i + INSERT_BATCH_SIZE)
    const { error: insertError } = await supabase
      .from('curation_job_targets')
      .insert(batch)

    if (insertError) {
      throw new Error(
        `Failed to insert target batch at offset ${i}: ${insertError.message}`,
      )
    }
    inserted += batch.length
  }

  console.log(`Seeded ${inserted} curation_job_targets rows under job ${job.id}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
