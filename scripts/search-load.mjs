import { randomUUID } from 'node:crypto'

const DEFAULT_BASE_URL = 'http://localhost:3000'
const WARMUP_REQUESTS = 10

function readPositiveInteger(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function percentile(sorted, value) {
  const index = Math.max(0, Math.ceil((value / 100) * sorted.length) - 1)
  return sorted[index] ?? 0
}

function assertAllowedTarget(baseUrl) {
  const isLoopback = isLoopbackTarget(baseUrl)
  if (!isLoopback && process.env.SEARCH_LOAD_ALLOW_REMOTE !== '1') {
    throw new Error(
      `Refusing non-loopback target ${baseUrl.origin}; set SEARCH_LOAD_ALLOW_REMOTE=1 to allow it`,
    )
  }
}

function isLoopbackTarget(baseUrl) {
  const hostname = baseUrl.hostname.replace(/^\[|\]$/g, '')
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function supabaseHeaders(serviceRoleKey, prefer) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  }
}

async function seedProbe(supabaseUrl, serviceRoleKey, token) {
  const response = await fetch(`${supabaseUrl}/rest/v1/brands`, {
    method: 'POST',
    headers: supabaseHeaders(serviceRoleKey, 'return=representation'),
    body: JSON.stringify({
      name: `[E2E-TEST] ${token} Search Load Probe`,
      slug: `e2e-search-load-${token}`,
      status: 'approved',
      product_type: 'crafts',
      description: `[E2E-TEST] Search load probe ${token}.`,
      blurb_en: `${token} punctuation load probe.`,
      retail_locations: [],
      is_demo: false,
    }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(body) || typeof body[0]?.id !== 'string') {
    throw new Error(`Search load seed failed (${response.status}): ${JSON.stringify(body)}`)
  }
  return { id: body[0].id, slug: body[0].slug }
}

async function cleanupProbe(supabaseUrl, serviceRoleKey, id) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/brands?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: supabaseHeaders(serviceRoleKey),
    },
  )
  if (!response.ok) {
    throw new Error(`Search load cleanup failed (${response.status}): ${await response.text()}`)
  }
}

function isSearchResult(value) {
  return value
    && typeof value === 'object'
    && typeof value.id === 'string'
    && typeof value.slug === 'string'
    && typeof value.name === 'string'
    && typeof value.category === 'string'
}

async function makeSearchRequest(searchUrl, query, expectedSlug, expectEmpty, clientIp) {
  const url = new URL('/api/search', searchUrl)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '10')
  const startedAt = performance.now()

  try {
    const response = await fetch(url, {
      headers: clientIp ? { 'X-Forwarded-For': clientIp } : undefined,
    })
    const latencyMs = performance.now() - startedAt
    if (!response.ok) {
      return { latencyMs, statusFailure: `${response.status} ${response.statusText}` }
    }

    const body = await response.json().catch(() => null)
    if (!body || !Array.isArray(body.results) || !body.results.every(isSearchResult)) {
      return { latencyMs, schemaFailure: JSON.stringify(body) }
    }

    if (expectEmpty && body.results.length > 0) {
      return { latencyMs, correctnessFailure: `expected no results for ${JSON.stringify(query)}` }
    }
    if (!expectEmpty && !body.results.some((result) => result.slug === expectedSlug)) {
      return { latencyMs, missingSeededResult: query }
    }
    return { latencyMs }
  } catch (error) {
    return {
      latencyMs: performance.now() - startedAt,
      statusFailure: error instanceof Error ? error.message : String(error),
    }
  }
}

async function run() {
  const baseUrl = new URL(process.env.SEARCH_LOAD_BASE_URL ?? DEFAULT_BASE_URL)
  assertAllowedTarget(baseUrl)

  const totalRequests = readPositiveInteger('SEARCH_LOAD_REQUESTS', 200)
  const concurrency = Math.min(
    readPositiveInteger('SEARCH_LOAD_CONCURRENCY', 20),
    totalRequests,
  )
  const p95LimitMs = readPositiveInteger('SEARCH_LOAD_P95_MS', 800)
  const useLoopbackClients = isLoopbackTarget(baseUrl)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }

  const token = `probe${randomUUID().replaceAll('-', '')}`
  let probe
  try {
    probe = await seedProbe(supabaseUrl, serviceRoleKey, token)
    const missingQuery = `zzq${randomUUID().replaceAll('-', '')}xv`
    const requestCases = [
      { query: token, expectEmpty: false },
      { query: token.slice(0, -3), expectEmpty: false },
      { query: missingQuery, expectEmpty: true },
      { query: `${token}!`, expectEmpty: false },
    ]

    for (let index = 0; index < WARMUP_REQUESTS; index += 1) {
      const requestCase = requestCases[index % requestCases.length]
      const result = await makeSearchRequest(
        baseUrl,
        requestCase.query,
        probe.slug,
        requestCase.expectEmpty,
        useLoopbackClients ? `127.0.1.${index + 1}` : undefined,
      )
      if (
        result.statusFailure
        || result.schemaFailure
        || result.correctnessFailure
        || result.missingSeededResult
      ) {
        throw new Error(`Warm-up correctness failure: ${JSON.stringify(result)}`)
      }
    }

    const results = new Array(totalRequests)
    let nextIndex = 0
    const measuredStartedAt = performance.now()

    async function worker() {
      while (nextIndex < totalRequests) {
        const index = nextIndex
        nextIndex += 1
        const requestCase = requestCases[index % requestCases.length]
        results[index] = await makeSearchRequest(
          baseUrl,
          requestCase.query,
          probe.slug,
          requestCase.expectEmpty,
          useLoopbackClients ? `127.0.2.${(index % concurrency) + 1}` : undefined,
        )
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()))
    const elapsedMs = performance.now() - measuredStartedAt
    const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b)
    const statusFailures = results.filter((result) => result.statusFailure)
    const statusFailureCounts = Object.fromEntries(
      Object.entries(Object.groupBy(statusFailures, (result) => result.statusFailure))
        .map(([status, failures]) => [status, failures?.length ?? 0]),
    )
    const schemaFailures = results.filter((result) => result.schemaFailure)
    const correctnessFailures = results.filter((result) => result.correctnessFailure)
    const missingSeededResults = results.filter((result) => result.missingSeededResult)
    const report = {
      target: baseUrl.origin,
      requests: totalRequests,
      concurrency,
      warmups: WARMUP_REQUESTS,
      p50Ms: Number(percentile(latencies, 50).toFixed(1)),
      p95Ms: Number(percentile(latencies, 95).toFixed(1)),
      p99Ms: Number(percentile(latencies, 99).toFixed(1)),
      throughputRps: Number((totalRequests / (elapsedMs / 1000)).toFixed(1)),
      statusFailures: statusFailures.length,
      statusFailureCounts,
      schemaFailures: schemaFailures.length,
      correctnessFailures: correctnessFailures.length,
      missingSeededResults: missingSeededResults.length,
      p95LimitMs,
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

    if (
      statusFailures.length
      || schemaFailures.length
      || correctnessFailures.length
      || missingSeededResults.length
      || report.p95Ms > p95LimitMs
    ) {
      throw new Error('Search load gate failed')
    }
  } finally {
    if (probe?.id) await cleanupProbe(supabaseUrl, serviceRoleKey, probe.id)
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
