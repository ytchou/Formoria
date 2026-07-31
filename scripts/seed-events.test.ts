import { describe, expect, it } from 'vitest'
import {
  parseEventFile,
  planEventSeed,
  type EventBrandInput,
  type EventFileInput,
} from './seed-events'

const SUPABASE_URL = 'https://xkcayngbttpxyibgzern.supabase.co'
const HERO_URL = `${SUPABASE_URL}/storage/v1/object/public/brand-images/events/hero.webp`

const EVENT_ID = '6b1c9f2e-0000-4000-8000-000000000001'
const BRAND_ID_A = '6b1c9f2e-0000-4000-8000-00000000000a'
const BRAND_ID_B = '6b1c9f2e-0000-4000-8000-00000000000b'

function makeFile(overrides: Partial<EventFileInput> = {}): EventFileInput {
  return {
    slug: 'taipei-design-market-2026',
    name: '台北設計市集 2026',
    summary: '集結百家台灣品牌的年度設計市集。',
    startsOn: '2026-08-06',
    endsOn: '2026-08-09',
    ...overrides,
  }
}

function plan(
  brands: EventBrandInput[] | null | undefined,
  existingBrandIds: string[],
) {
  return planEventSeed({
    eventSlug: 'taipei-design-market-2026',
    eventId: EVENT_ID,
    brands: brands === undefined ? null : brands,
    brandIdsBySlug: new Map([
      ['kinyo-ceramics', BRAND_ID_A],
      ['liuli-atelier', BRAND_ID_B],
    ]),
    existingBrandIds,
  })
}

describe('parseEventFile', () => {
  it('parseEventFile_rejects_bad_slug: names the offending slug', () => {
    expect(() =>
      parseEventFile('bad-slug.json', makeFile({ slug: 'Taipei_Market' })),
    ).toThrow(/Taipei_Market/)
  })

  it('parseEventFile_rejects_inverted_dates: endsOn before startsOn', () => {
    expect(() =>
      parseEventFile(
        'inverted.json',
        makeFile({ startsOn: '2026-08-09', endsOn: '2026-08-06' }),
      ),
    ).toThrow(/2026-08-06/)
  })

  it('parseEventFile_rejects_foreign_image_host: hero outside Supabase Storage', () => {
    expect(() =>
      parseEventFile(
        'foreign-host.json',
        makeFile({ heroImageUrl: 'https://cdn.example.com/hero.jpg' }),
      ),
    ).toThrow(/cdn\.example\.com/)

    // The same field on the storage origin is accepted, so the guard is about
    // the host and not about heroImageUrl being set at all.
    const parsed = parseEventFile(
      'ok.json',
      makeFile({ heroImageUrl: HERO_URL }),
    )
    expect(parsed.row.hero_image_url).toBe(HERO_URL)
  })

  it('maps camelCase input onto the snake_case row and defaults status to draft', () => {
    const parsed = parseEventFile('ok.json', makeFile({ nameEn: 'Taipei Design Market 2026' }))

    expect(parsed.row.slug).toBe('taipei-design-market-2026')
    expect(parsed.row.name_en).toBe('Taipei Design Market 2026')
    expect(parsed.row.starts_on).toBe('2026-08-06')
    expect(parsed.row.status).toBe('draft')
    expect(parsed.brands).toBeNull()
  })
})

describe('planEventSeed', () => {
  it('planEventSeed_prunes_removed_brands: existing row absent from the file is deleted', () => {
    const result = plan([{ slug: 'kinyo-ceramics' }], [BRAND_ID_A, BRAND_ID_B])

    expect(result.deleteBrandIds).toEqual([BRAND_ID_B])
    expect(result.upsertRows.map((row) => row.brand_id)).toEqual([BRAND_ID_A])
    expect(result.insertCount).toBe(0)
    expect(result.updateCount).toBe(1)
  })

  it('planEventSeed_absent_brands_key_prunes_nothing: [] prunes all', () => {
    const absent = plan(undefined, [BRAND_ID_A, BRAND_ID_B])
    expect(absent.deleteBrandIds).toEqual([])
    expect(absent.upsertRows).toEqual([])

    const empty = plan([], [BRAND_ID_A, BRAND_ID_B])
    expect(empty.deleteBrandIds).toEqual([BRAND_ID_A, BRAND_ID_B])
    expect(empty.upsertRows).toEqual([])
  })

  it('reports unknown brand slugs instead of writing them', () => {
    const result = plan(
      [{ slug: 'kinyo-ceramics' }, { slug: 'not-a-real-brand' }],
      [],
    )

    expect(result.unknownBrandSlugs).toEqual(['not-a-real-brand'])
    expect(result.upsertRows.map((row) => row.brand_id)).toEqual([BRAND_ID_A])
    expect(result.insertCount).toBe(1)
  })
})
