import { parseCsvRecords } from '../seo/gsc-404-triage'
import type {
  StockistCandidate,
  StockistLocationType,
} from '@/lib/types/stockist'
import { citySlugFromName } from '@/lib/constants/taiwan-cities'
import { matchDistrict } from '@/lib/brands/district'

export const STOCKIST_HEADER = [
  'brand_slug',
  'name',
  'location_type',
  'region_label',
  'address',
  'url',
  'evidence_url',
  'source_type',
  'source_chain',
  'confidence',
  'notes',
] as const

export type StockistCsvRow = {
  [Column in (typeof STOCKIST_HEADER)[number]]: string
}

export type NormalizedStockist = {
  brandSlug: string
  sourceType: string
  candidate: StockistCandidate
}

export type NormalizeResult =
  | { ok: true; row: NormalizedStockist }
  | { ok: false; brandSlug: string; reason: string }

const CHAIN_REGION_LABEL = '全台多間門市'
const TAIWAN_REGIONS = new Map<string, string>([
  ['臺北市', '臺北市'],
  ['台北市', '臺北市'],
  ['台北', '臺北市'],
  ['新北市', '新北市'],
  ['新北', '新北市'],
  ['桃園市', '桃園市'],
  ['桃園', '桃園市'],
  ['臺中市', '臺中市'],
  ['台中市', '臺中市'],
  ['台中', '臺中市'],
  ['臺南市', '臺南市'],
  ['台南市', '臺南市'],
  ['台南', '臺南市'],
  ['高雄市', '高雄市'],
  ['高雄', '高雄市'],
  ['基隆市', '基隆市'],
  ['新竹市', '新竹市'],
  ['新竹', '新竹市'],
  ['嘉義市', '嘉義市'],
  ['嘉義', '嘉義市'],
  ['新竹縣', '新竹縣'],
  ['苗栗縣', '苗栗縣'],
  ['苗栗', '苗栗縣'],
  ['彰化縣', '彰化縣'],
  ['彰化', '彰化縣'],
  ['南投縣', '南投縣'],
  ['南投', '南投縣'],
  ['雲林縣', '雲林縣'],
  ['雲林', '雲林縣'],
  ['嘉義縣', '嘉義縣'],
  ['屏東縣', '屏東縣'],
  ['屏東', '屏東縣'],
  ['宜蘭縣', '宜蘭縣'],
  ['宜蘭', '宜蘭縣'],
  ['花蓮縣', '花蓮縣'],
  ['花蓮', '花蓮縣'],
  ['臺東縣', '臺東縣'],
  ['台東縣', '臺東縣'],
  ['台東', '臺東縣'],
  ['澎湖縣', '澎湖縣'],
  ['金門縣', '金門縣'],
  ['連江縣', '連江縣'],
  [CHAIN_REGION_LABEL, CHAIN_REGION_LABEL],
])

const FOREIGN_COUNTRIES: Array<[RegExp, string]> = [
  [/^香港/, 'HK'],
  [/^澳門/, 'MO'],
  [/^中國/, 'CN'],
  [/^美國/, 'US'],
  [/^加拿大/, 'CA'],
  [/^日本/, 'JP'],
  [/^新加坡/, 'SG'],
  [/^英國/, 'GB'],
  [/^(?:澳洲|Queensland, Australia)/, 'AU'],
  [/^韓國/, 'KR'],
  [/^泰國/, 'TH'],
  [/^法國/, 'FR'],
  [/^土耳其/, 'TR'],
  [/^奧地利/, 'AT'],
  [/^德國/, 'DE'],
  [/^挪威/, 'NO'],
  [/^比利時/, 'BE'],
  [/^烏克蘭/, 'UA'],
  [/^瑞典/, 'SE'],
  [/^瑞士/, 'CH'],
  [/^義大利/, 'IT'],
  [/^葡萄牙/, 'PT'],
  [/^馬來西亞/, 'MY'],
]

function trimNullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed || null
}

export function parseStockistCsv(
  raw: string,
  fileName: string,
): StockistCsvRow[] {
  const [header, ...records] = parseCsvRecords(raw.replace(/^\uFEFF/, ''))
  if (!header || header.join(',') !== STOCKIST_HEADER.join(',')) {
    throw new Error(`${fileName}: unexpected CSV header`)
  }

  return records.map((record, rowIndex) => {
    if (record.length !== STOCKIST_HEADER.length) {
      throw new Error(
        `${fileName}:${rowIndex + 2}: expected ${STOCKIST_HEADER.length} columns, found ${record.length}`,
      )
    }
    return Object.fromEntries(
      STOCKIST_HEADER.map((column, index) => [column, record.at(index) ?? '']),
    ) as StockistCsvRow
  })
}

export function canonicalizeRegion(
  region: string,
):
  | { ok: true; regionLabel: string; country: string }
  | { ok: false; reason: string } {
  const value = region.trim()
  const taiwanRegion = TAIWAN_REGIONS.get(value)
  if (taiwanRegion) {
    return { ok: true, regionLabel: taiwanRegion, country: 'TW' }
  }

  for (const [pattern, country] of FOREIGN_COUNTRIES) {
    if (pattern.test(value)) {
      return { ok: true, regionLabel: value, country }
    }
  }

  if (/[台臺縣市]/.test(value)) {
    return { ok: false, reason: `unmapped Taiwan region: ${value}` }
  }
  return { ok: false, reason: `unmapped foreign region: ${value}` }
}

/**
 * A keyset, not an array, and that shape is load-bearing. `satisfies
 * Record<StockistLocationType, true>` makes a missing member a compile error, so
 * adding a location type to the union breaks the build until this map is
 * updated. An array with `satisfies readonly StockistLocationType[]` would only
 * check that every entry is valid, not that every member is present — a new
 * type would compile clean and then be rejected row by row at import time with
 * a generic reason, silently dropping stockists. The object also stops the
 * per-call allocation the array version paid.
 */
const LOCATION_TYPES = {
  stockist: true,
  distributor_retailer: true,
  direct_store: true,
  department_store_counter: true,
  showroom_studio: true,
  shop_in_shop: true,
  other_physical_retail: true,
} satisfies Record<StockistLocationType, true>

function isLocationType(value: string): value is StockistLocationType {
  // `Object.hasOwn`, not `in`: `in` walks the prototype, so a CSV row saying
  // `constructor` or `toString` would type-narrow to StockistLocationType.
  return Object.hasOwn(LOCATION_TYPES, value)
}

export function normalizeStockistRow(
  raw: StockistCsvRow,
  fetchedAt = '2026-08-11T00:00:00.000Z',
): NormalizeResult {
  const brandSlug = raw.brand_slug.trim()
  const locationType = raw.location_type.trim()
  if (!isLocationType(locationType)) {
    return {
      ok: false,
      brandSlug,
      reason: `unknown location type: ${locationType}`,
    }
  }
  const region = canonicalizeRegion(raw.region_label)
  if (!region.ok) return { ok: false, brandSlug, reason: region.reason }

  const name = raw.name.trim()
  const address = trimNullable(raw.address)
  const city = region.country === 'TW' ? citySlugFromName(region.regionLabel) : null
  return {
    ok: true,
    row: {
      brandSlug,
      sourceType: raw.source_type.trim(),
      candidate: {
        name,
        normalizedName: name,
        regionLabel: region.regionLabel,
        address,
        district: address && city ? matchDistrict(address, city) : null,
        url: trimNullable(raw.url),
        sourceUrl: raw.evidence_url.trim(),
        fetchedAt,
        locationType,
        country: region.country,
        providerMetadata: {
          source_chain: trimNullable(raw.source_chain),
          confidence: trimNullable(raw.confidence),
          notes: trimNullable(raw.notes),
        },
        source: 'import',
      },
    },
  }
}
