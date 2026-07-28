/**
 * Seeds the public feature request board with a small set of starter requests.
 *
 * PLACEHOLDER CONTENT: the array below is a stand-in. Replace it with the real
 * requests drawn from Linear tickets and the retained Tally responses before
 * running this against production.
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
    title: 'Email alerts when my brand receives a new review',
    body: 'As a brand owner I want a notification when someone reviews my brand so I can respond quickly instead of checking the dashboard.',
    category: 'owner',
  },
  {
    title: 'Bulk edit product tags from the owner dashboard',
    body: 'Editing tags one product at a time is slow for brands with a large catalog. A multi-select bulk edit would make catalog cleanup practical.',
    category: 'owner',
  },
  {
    title: 'Save searches and get notified about new matching brands',
    body: 'Let visitors save a filter combination (category plus verification tier) and receive a digest when new brands match it.',
    category: 'visitor',
  },
  {
    title: 'Compare two brands side by side',
    body: 'A comparison view showing verification tier, categories, and origin evidence for two brands at once would help when deciding between similar options.',
    category: 'visitor',
  },
  {
    title: 'Map view of brands with physical stores',
    body: 'Many brands list a storefront address. A map view would make it easy to find Taiwanese brands to visit in person.',
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
