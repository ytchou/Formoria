import { createServiceClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LinkStatus = 'ok' | 'broken' | 'blocked'

export interface LinkHealthDeps {
  /** Fetch function used for URL health checks */
  fetchFn?: typeof fetch
  /** Fetch function used for Agent Hub delivery (defaults to fetchFn if not set) */
  deliverFn?: typeof fetch
}

export interface LinkHealthSummary {
  checked: number
  ok: number
  broken: number
  blocked: number
  autoNulled: { brandId: string; field: string; url: string }[]
  heroBroken: { brandId: string; url: string }[]
  heroExternal: { brandId: string; url: string }[]
  failingRows: { brandId: string; field: string; url: string; consecutiveFailures: number }[]
  severity: 'ok' | 'warning' | 'critical'
}

type CheckedField = 'purchase_website' | 'purchase_pinkoi' | 'purchase_shopee' | 'hero_image_url'
type PurchaseField = Exclude<CheckedField, 'hero_image_url'>

const CHECKED_FIELDS: CheckedField[] = [
  'purchase_website',
  'purchase_pinkoi',
  'purchase_shopee',
  'hero_image_url',
]

const PURCHASE_FIELDS = new Set<string>(['purchase_website', 'purchase_pinkoi', 'purchase_shopee'])

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const TIMEOUT_MS = 10_000
const CONCURRENCY = 5
/** HTTP status codes that trigger a GET retry */
const RETRY_ON = new Set([403, 405, 501])

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the URL points to this project's Supabase Storage bucket.
 * Falls back to hostname-based detection when NEXT_PUBLIC_SUPABASE_URL is not set.
 */
function isSupabaseStorageUrl(url: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (supabaseUrl && url.startsWith(`${supabaseUrl}/storage/`)) return true
  try {
    const parsed = new URL(url)
    return (
      parsed.hostname.toLowerCase().endsWith('.supabase.co') &&
      parsed.pathname.startsWith('/storage/')
    )
  } catch {
    return false
  }
}

function getTaipeiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Taipei',
    year: 'numeric',
  }).formatToParts(date)
  const p = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${p('year')}-${p('month')}-${p('day')}`
}

// ---------------------------------------------------------------------------
// URL checking
// ---------------------------------------------------------------------------

/**
 * Performs an HTTP HEAD (with optional GET retry) to classify the URL.
 * Exported for direct unit testing.
 */
export async function checkUrl(
  url: string,
  fetchFn: typeof fetch,
): Promise<{ status: LinkStatus; statusCode: number | null }> {
  const headers = { 'User-Agent': BROWSER_UA }

  // HEAD attempt
  let statusCode: number | null = null
  try {
    const res = await fetchFn(url, {
      method: 'HEAD',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    statusCode = res.status
  } catch {
    return { status: 'broken', statusCode: null }
  }

  // 2xx/3xx → ok
  if (statusCode >= 200 && statusCode < 400) return { status: 'ok', statusCode }
  // 429 from HEAD → blocked (WAF rate-limit, don't retry)
  if (statusCode === 429) return { status: 'blocked', statusCode }
  // 404/410 → broken (no retry; resource is definitively gone)
  if (statusCode === 404 || statusCode === 410) return { status: 'broken', statusCode }

  // 403/405/501 → retry with GET
  if (RETRY_ON.has(statusCode)) {
    let getStatus: number | null = null
    try {
      const res = await fetchFn(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      getStatus = res.status
    } catch {
      return { status: 'broken', statusCode: null }
    }

    if (getStatus === 403 || getStatus === 429) return { status: 'blocked', statusCode: getStatus }
    if (getStatus >= 200 && getStatus < 400) return { status: 'ok', statusCode: getStatus }
    return { status: 'broken', statusCode: getStatus }
  }

  // Remaining 5xx
  return { status: 'broken', statusCode }
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function runConcurrent<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let index = 0

  async function worker() {
    while (index < tasks.length) {
      const taskIndex = index++
      // Jitter: 0–200 ms to spread requests
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 200))
      results[taskIndex] = await tasks[taskIndex]()
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  )
  return results
}

// ---------------------------------------------------------------------------
// Agent Hub delivery (fail-soft)
// ---------------------------------------------------------------------------

async function deliverReport(
  envelope: Record<string, unknown>,
  deliverFn: typeof fetch,
): Promise<void> {
  const url = process.env.AGENT_HUB_INGEST_URL
  const token = process.env.AGENT_HUB_INGEST_TOKEN

  if (!url || !token) {
    console.error(
      JSON.stringify({ event: 'link_health_delivery_skipped', reason: 'missing env vars' }),
    )
    return
  }

  try {
    const res = await deliverFn(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-request-id': crypto.randomUUID(),
      },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(15_000),
    })
    console.log(JSON.stringify({ event: 'link_health_delivered', status: res.status }))
  } catch (err) {
    // Delivery failure must never fail the run
    console.error(
      JSON.stringify({
        event: 'link_health_delivery_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }
}

// ---------------------------------------------------------------------------
// Main service
// ---------------------------------------------------------------------------

export async function runLinkHealthCheck(deps?: LinkHealthDeps): Promise<LinkHealthSummary> {
  const fetchFn = deps?.fetchFn ?? fetch
  const deliverFn = deps?.deliverFn ?? fetchFn
  const supabase = createServiceClient()
  const now = new Date().toISOString()

  // ── 1. Load approved brands ──────────────────────────────────────────────
  const { data: brands, error: brandsError } = await supabase
    .from('brands')
    .select('id, purchase_website, purchase_pinkoi, purchase_shopee, hero_image_url')
    .eq('status', 'approved')

  if (brandsError) throw new Error(`Failed to load brands: ${brandsError.message}`)

  const brandList = brands ?? []
  const brandIds = brandList.map((b) => b.id)

  // ── 2. Build URL tasks (skip null/blank) ─────────────────────────────────
  type UrlTask = { brandId: string; field: CheckedField; url: string }
  const urlTasks: UrlTask[] = []
  for (const brand of brandList) {
    for (const field of CHECKED_FIELDS) {
      const url = brand[field as keyof typeof brand] as string | null
      if (url) urlTasks.push({ brandId: brand.id, field, url })
    }
  }

  // ── 3. Load existing rows for ALL approved brands ────────────────────────
  type ExistingRow = {
    id: string
    brand_id: string
    field: string
    url: string
    consecutive_failures: number
    last_ok_at: string | null
    auto_nulled_at: string | null
  }

  const existingRows: ExistingRow[] = []
  if (brandIds.length > 0) {
    const { data, error } = await supabase
      .from('link_check_results')
      .select('id, brand_id, field, url, consecutive_failures, last_ok_at, auto_nulled_at')
      .in('brand_id', brandIds)
    if (error) throw new Error(`Failed to load link_check_results: ${error.message}`)
    existingRows.push(...(data ?? []))
  }

  // Build lookup: `${brand_id}:${field}` → existing row
  const existingMap = new Map<string, ExistingRow>()
  for (const row of existingRows) {
    existingMap.set(`${row.brand_id}:${row.field}`, row)
  }

  // ── 4. Identify and delete stale rows (URL cleared) ──────────────────────
  const currentUrlSet = new Set(urlTasks.map((t) => `${t.brandId}:${t.field}`))
  const staleIds = existingRows
    .filter((row) => !currentUrlSet.has(`${row.brand_id}:${row.field}`))
    .map((row) => row.id)

  if (staleIds.length > 0) {
    await supabase.from('link_check_results').delete().in('id', staleIds)
  }

  if (urlTasks.length === 0) {
    const summary: LinkHealthSummary = {
      checked: 0,
      ok: 0,
      broken: 0,
      blocked: 0,
      autoNulled: [],
      heroBroken: [],
      heroExternal: [],
      failingRows: [],
      severity: 'ok',
    }
    const runAt = now
    const date = getTaipeiDate(new Date())
    await deliverReport(buildEnvelope(summary, date, runAt), deliverFn)
    return summary
  }

  // ── 5. Check URLs concurrently ────────────────────────────────────────────
  type CheckResultEntry = UrlTask & { status: LinkStatus; statusCode: number | null }
  const checkResults: CheckResultEntry[] = await runConcurrent(
    urlTasks.map((task) => async () => {
      const result = await checkUrl(task.url, fetchFn)
      return { ...task, ...result }
    }),
    CONCURRENCY,
  )

  // ── 6. Build upsert rows ─────────────────────────────────────────────────
  type UpsertRow = {
    brand_id: string
    field: string
    url: string
    last_status_code: number | null
    last_ok_at: string | null
    last_checked_at: string
    consecutive_failures: number
    auto_nulled_at: string | null
  }

  const upsertRows: UpsertRow[] = []
  const blockedKeys = new Set<string>()

  // Summary accumulators
  let okCount = 0
  let brokenCount = 0
  let blockedCount = 0
  const failingRows: LinkHealthSummary['failingRows'] = []
  const heroBroken: LinkHealthSummary['heroBroken'] = []
  const heroExternal: LinkHealthSummary['heroExternal'] = []

  for (const result of checkResults) {
    const key = `${result.brandId}:${result.field}`
    const existing = existingMap.get(key)
    const urlChanged = existing !== undefined && existing.url !== result.url

    let consecutiveFailures: number
    let lastOkAt: string | null
    let autoNulledAt: string | null

    if (result.status === 'ok') {
      consecutiveFailures = 0
      lastOkAt = now
      autoNulledAt = null
      okCount++
    } else if (result.status === 'blocked') {
      // WAF-fronted shops: do NOT change failure counter
      consecutiveFailures = urlChanged ? 0 : (existing?.consecutive_failures ?? 0)
      lastOkAt = existing?.last_ok_at ?? null
      autoNulledAt = urlChanged ? null : (existing?.auto_nulled_at ?? null)
      blockedKeys.add(key)
      blockedCount++
    } else {
      // broken
      if (urlChanged || !existing) {
        consecutiveFailures = 1
        autoNulledAt = null
      } else {
        consecutiveFailures = existing.consecutive_failures + 1
        autoNulledAt = existing.auto_nulled_at ?? null
      }
      lastOkAt = existing?.last_ok_at ?? null
      brokenCount++

      failingRows.push({
        brandId: result.brandId,
        field: result.field,
        url: result.url,
        consecutiveFailures,
      })

      // Hero tracking
      if (result.field === 'hero_image_url') {
        if (isSupabaseStorageUrl(result.url)) {
          heroBroken.push({ brandId: result.brandId, url: result.url })
        } else {
          heroExternal.push({ brandId: result.brandId, url: result.url })
        }
      }
    }

    upsertRows.push({
      brand_id: result.brandId,
      field: result.field,
      url: result.url,
      last_status_code: result.statusCode,
      last_ok_at: lastOkAt,
      last_checked_at: now,
      consecutive_failures: consecutiveFailures,
      auto_nulled_at: autoNulledAt,
    })
  }

  // ── 7. Bulk upsert all rows ───────────────────────────────────────────────
  if (upsertRows.length > 0) {
    const { error: upsertError } = await supabase
      .from('link_check_results')
      .upsert(upsertRows, { onConflict: 'brand_id,field' })
    if (upsertError) throw new Error(`Failed to upsert link_check_results: ${upsertError.message}`)
  }

  // ── 8. Auto-null purchase fields at consecutive_failures >= 3 ─────────────
  const autoNulled: LinkHealthSummary['autoNulled'] = []
  const autoNullCandidates = upsertRows.filter(
    (row) =>
      PURCHASE_FIELDS.has(row.field) &&
      row.consecutive_failures >= 3 &&
      !row.auto_nulled_at && // Not already nulled in this row state
      !blockedKeys.has(`${row.brand_id}:${row.field}`), // WAF-blocked URLs must never be auto-nulled
  )

  for (const row of autoNullCandidates) {
    // Null the brand field
    await supabase
      .from('brands')
      .update({ [row.field as PurchaseField]: null })
      .eq('id', row.brand_id)

    // Stamp auto_nulled_at on the audit row (keep row + url)
    await supabase
      .from('link_check_results')
      .update({ auto_nulled_at: now })
      .eq('brand_id', row.brand_id)
      .eq('field', row.field)

    autoNulled.push({ brandId: row.brand_id, field: row.field, url: row.url })
  }

  // ── 9. Build summary and deliver ─────────────────────────────────────────
  const severity: LinkHealthSummary['severity'] =
    heroBroken.length > 0
      ? 'critical'
      : autoNulled.length > 0 || failingRows.length > 0
        ? 'warning'
        : 'ok'

  const summary: LinkHealthSummary = {
    checked: urlTasks.length,
    ok: okCount,
    broken: brokenCount,
    blocked: blockedCount,
    autoNulled,
    heroBroken,
    heroExternal,
    failingRows,
    severity,
  }

  const date = getTaipeiDate(new Date())
  await deliverReport(buildEnvelope(summary, date, now), deliverFn)

  return summary
}

// ---------------------------------------------------------------------------
// Envelope builder
// ---------------------------------------------------------------------------

function buildEnvelope(
  summary: LinkHealthSummary,
  date: string,
  runAt: string,
): Record<string, unknown> {
  const verdictText =
    `Checked ${summary.checked} links: ${summary.ok} ok, ` +
    `${summary.broken} broken, ${summary.blocked} blocked. ` +
    `Auto-nulled: ${summary.autoNulled.length}. ` +
    `Hero broken: ${summary.heroBroken.length}.`

  return {
    version: 1,
    source: 'railway_cron',
    routine: 'link-checker',
    project: 'formoria',
    source_run_id: `railway-cron:${date}`,
    date,
    run_at: runAt,
    status: 'success',
    verdict_severity: summary.severity,
    verdict_text: verdictText,
    tickets_created: [],
    data: {
      checked: summary.checked,
      ok: summary.ok,
      broken: summary.broken,
      blocked: summary.blocked,
      auto_nulled: summary.autoNulled,
      hero_broken: summary.heroBroken,
      hero_external: summary.heroExternal,
      failing_rows: summary.failingRows,
    },
  }
}
