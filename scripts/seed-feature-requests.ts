/**
 * Seeds the public feature request board with a small set of starter requests.
 *
 * Starter content is derived from open Formoria Linear feature tickets.
 *
 * Seeded rows carry `is_seed: true`, have no `submitted_by`, and start with
 * genuinely zero upvotes — this script never inserts votes.
 *
 * Each row also carries an initial `status`, so the board can open with
 * something visibly in progress rather than a wall of `open`. That status is an
 * insert-time value only; see the skip logic in `main` for why re-runs never
 * touch it.
 *
 * Run: pnpm tsx --env-file=.env.local scripts/seed-feature-requests.ts
 */
import { createServiceClient } from '@/lib/supabase/server'

type SeedRequest = {
  title: string
  body: string
  status: 'open' | 'planned' | 'in_progress' | 'shipped'
}

const SEED_REQUESTS: SeedRequest[] = [
  {
    title: 'Add reviews and ratings to brand pages',
    body: 'Let signed-in visitors share their experience with a brand so shoppers can judge customer experience separately from Made-in-Taiwan verification.',
    status: 'open',
  },
  {
    title: 'Browse Taiwanese brands by occasion',
    body: 'Let visitors discover brands by shopping intent, such as gifts, small-apartment decor, or sustainable essentials, without needing to understand the category structure first.',
    status: 'open',
  },
  {
    title: 'Show nearby Taiwanese brands on a map',
    body: 'Let visitors browse brands with physical locations on one map and filter by city, district, and category to find places they can visit nearby.',
    status: 'in_progress',
  },
  {
    // Title must stay character-for-character identical to the
    // `FEATURE_REQUEST_I18N_KEYS_BY_TITLE` entry in
    // `@/lib/services/feature-requests` — that map is what localizes a seed
    // row, and a drifted title silently falls back to this English string on
    // the zh-TW board.
    title: 'Let brand owners claim and manage their brand page',
    body: "Let a brand's owner verify they represent the brand, then keep its description, links, and purchase channels up to date themselves.",
    status: 'in_progress',
  },
]

async function main(): Promise<void> {
  const supabase = createServiceClient()

  const titles = SEED_REQUESTS.map((request) => request.title)
  const { data: existing, error: existingError } = await supabase
    .from('feature_requests')
    .select('title')
    .in('title', titles)

  if (existingError) {
    console.error('Failed to read existing feature requests:', existingError)
    process.exit(1)
  }

  const existingTitles = new Set(
    (existing ?? []).map((row: { title: string }) => row.title),
  )
  // Skip, never upsert. `status` is owned by the admin queue the moment a row
  // exists, so the seeded value is an initial value applied on insert only — a
  // re-run that rewrote it would silently revert a moderator's decision (an
  // in_progress row shipped last week would drop back to in_progress).
  const pending = SEED_REQUESTS.filter(
    (request) => !existingTitles.has(request.title),
  )

  if (pending.length === 0) {
    console.log('All seed feature requests already exist — nothing to do.')
    return
  }

  const { error: insertError } = await supabase.from('feature_requests').insert(
    pending.map((request) => ({
      title: request.title,
      body: request.body,
      status: request.status,
      is_seed: true,
      submitted_by: null,
    })),
  )

  if (insertError) {
    console.error('Failed to insert feature requests:', insertError)
    process.exit(1)
  }

  for (const request of pending) {
    console.log(`[seeded] ${request.title}`)
  }
  console.log(
    `Done. Inserted ${pending.length}, skipped ${SEED_REQUESTS.length - pending.length} existing.`,
  )
}

main().catch((error) => {
  console.error('Seed script failed:', error)
  process.exit(1)
})
