/**
 * Seeds the public feature request board with a small set of starter requests.
 *
 * Starter content is derived from open Formoria Linear feature tickets.
 *
 * Seeded rows carry `is_seed: true`, have no `submitted_by`, and start with
 * genuinely zero upvotes — this script never inserts votes.
 *
 * Run: pnpm tsx --env-file=.env.local scripts/seed-feature-requests.ts
 */
import { createServiceClient } from '@/lib/supabase/server'

type SeedRequest = {
  title: string
  body: string
  category: 'owner' | 'visitor'
}

const SEED_REQUESTS: SeedRequest[] = [
  {
    title: 'Generate bilingual brand stories and social copy',
    body: 'Use my existing brand profile and Made-in-Taiwan story to create ready-to-use About-page copy, product stories, and social captions in Traditional Chinese and English.',
    category: 'owner',
  },
  {
    title: 'Show which marketing channels are working',
    body: 'Give small brand owners one simple dashboard that combines key channel results and explains what is working, what is not, and what to try next.',
    category: 'owner',
  },
  {
    title: 'Add reviews and ratings to brand pages',
    body: 'Let signed-in visitors share their experience with a brand so shoppers can judge customer experience separately from Made-in-Taiwan verification.',
    category: 'visitor',
  },
  {
    title: 'Browse Taiwanese brands by occasion',
    body: 'Let visitors discover brands by shopping intent, such as gifts, small-apartment decor, or sustainable essentials, without needing to understand the category structure first.',
    category: 'visitor',
  },
  {
    title: 'Show nearby Taiwanese brands on a map',
    body: 'Let visitors browse brands with physical locations on one map and filter by city, district, and category to find places they can visit nearby.',
    category: 'visitor',
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
      category: request.category,
      status: 'open',
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
