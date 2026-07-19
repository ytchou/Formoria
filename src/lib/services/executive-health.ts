import { createServiceClient } from '@/lib/supabase/server'

export type ExecutiveHealthStatus = 'healthy' | 'degraded' | 'down' | 'unconfigured'
export type ExecutiveHealthTier = 'customer-critical' | 'customer-flow' | 'back-office'
export type ExecutiveOverallHealth = 'healthy' | 'warning' | 'critical'

export interface ExecutiveServiceHealth {
  service: string
  tier: ExecutiveHealthTier
  status: ExecutiveHealthStatus
  message: string
  checkedAt: string
}

export interface ExecutiveHealthSnapshot {
  status: ExecutiveOverallHealth
  checkedAt: string
  services: ExecutiveServiceHealth[]
}

interface CheckResult {
  status: ExecutiveHealthStatus
  message: string
}

export interface ExecutiveHealthCheckDefinition {
  service: string
  tier: ExecutiveHealthTier
  request: Record<string, unknown>
  run(): Promise<CheckResult>
}

interface ExecutiveHealthAuditEvent {
  service: string
  request: Record<string, unknown>
  response: { status: ExecutiveHealthStatus; message: string }
  latencyMs: number
  status: 'success' | 'error'
}

type Audit = (event: ExecutiveHealthAuditEvent) => void

const CACHE_TTL_MS = 5 * 60_000

function defaultAudit(event: ExecutiveHealthAuditEvent): void {
  console.info('[executive-health:audit]', event)
}

export async function runExecutiveHealthCheck(
  definition: ExecutiveHealthCheckDefinition,
  audit: Audit = defaultAudit,
): Promise<ExecutiveServiceHealth> {
  const startedAt = performance.now()
  let checkResult: CheckResult

  try {
    checkResult = await definition.run()
  } catch {
    checkResult = { status: 'down', message: 'Provider request failed' }
  }

  const result: ExecutiveServiceHealth = {
    service: definition.service,
    tier: definition.tier,
    ...checkResult,
    checkedAt: new Date().toISOString(),
  }
  audit({
    service: definition.service,
    request: definition.request,
    response: { status: result.status, message: result.message },
    latencyMs: Math.round(performance.now() - startedAt),
    status: result.status === 'down' ? 'error' : 'success',
  })
  return result
}

export function classifyExecutiveHealth(
  services: ExecutiveServiceHealth[],
): ExecutiveOverallHealth {
  if (services.some((service) => service.tier === 'customer-critical' && service.status === 'down')) {
    return 'critical'
  }
  if (services.some((service) => service.status !== 'healthy')) return 'warning'
  return 'healthy'
}

async function loadExecutiveHealth(): Promise<ExecutiveHealthSnapshot> {
  const services = await Promise.all(defaultChecks().map((check) => runExecutiveHealthCheck(check)))
  return {
    status: classifyExecutiveHealth(services),
    checkedAt: new Date().toISOString(),
    services,
  }
}

export function createExecutiveHealthMonitor({
  load = loadExecutiveHealth,
  now = Date.now,
}: {
  load?: () => Promise<ExecutiveHealthSnapshot>
  now?: () => number
} = {}) {
  let cache: { value: ExecutiveHealthSnapshot; expiresAt: number } | null = null

  async function refresh(): Promise<ExecutiveHealthSnapshot> {
    const value = await load()
    cache = { value, expiresAt: now() + CACHE_TTL_MS }
    return value
  }

  async function get(): Promise<ExecutiveHealthSnapshot> {
    if (cache && cache.expiresAt > now()) return cache.value
    return refresh()
  }

  return { get, refresh }
}

const executiveHealthMonitor = createExecutiveHealthMonitor()

export function getExecutiveHealth(): Promise<ExecutiveHealthSnapshot> {
  return executiveHealthMonitor.get()
}

export function refreshExecutiveHealth(): Promise<ExecutiveHealthSnapshot> {
  return executiveHealthMonitor.refresh()
}

function configured(
  value: string | undefined,
  missingMessage: string,
  run: () => Promise<CheckResult>,
): () => Promise<CheckResult> {
  return value ? run : async () => ({ status: 'unconfigured', message: missingMessage })
}

function responseResult(response: Response, healthyMessage = 'API reachable'): CheckResult {
  return response.ok
    ? { status: 'healthy', message: healthyMessage }
    : { status: 'down', message: `API returned ${response.status}` }
}

function defaultChecks(): ExecutiveHealthCheckDefinition[] {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  const resendKey = process.env.RESEND_API_KEY
  const turnstileKey = process.env.TURNSTILE_SECRET_KEY
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
  const serperKey = process.env.SERPER_API_KEY
  const deepSeekKey = process.env.DEEPSEEK_API_KEY
  const openAiKey = process.env.OPENAI_API_KEY

  return [
    {
      service: 'Public site',
      tier: 'customer-critical',
      request: { endpoint: siteUrl ?? null, method: 'HEAD', configured: Boolean(siteUrl) },
      run: configured(siteUrl, 'Site URL is not configured', async () =>
        responseResult(
          await fetch(siteUrl!, { method: 'HEAD', signal: AbortSignal.timeout(3_000) }),
          'Site reachable',
        ),
      ),
    },
    {
      service: 'Supabase',
      tier: 'customer-critical',
      request: { table: 'brands', operation: 'select', limit: 1 },
      run: async () => {
        const { error } = await createServiceClient().from('brands').select('id').limit(1)
        return error
          ? { status: 'down', message: 'Database query failed' }
          : { status: 'healthy', message: 'Database reachable' }
      },
    },
    {
      service: 'Resend',
      tier: 'customer-flow',
      request: { endpoint: 'https://api.resend.com/domains', configured: Boolean(resendKey) },
      run: configured(resendKey, 'Resend is not configured', async () =>
        responseResult(
          await fetch('https://api.resend.com/domains', {
            headers: { Authorization: `Bearer ${resendKey}` },
            signal: AbortSignal.timeout(3_000),
          }),
        ),
      ),
    },
    {
      service: 'Turnstile',
      tier: 'customer-flow',
      request: {
        endpoint: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        configured: Boolean(turnstileKey),
      },
      run: configured(turnstileKey, 'Turnstile is not configured', async () => {
        const body = new FormData()
        body.set('secret', turnstileKey!)
        body.set('response', '')
        return responseResult(
          await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body,
            signal: AbortSignal.timeout(3_000),
          }),
        )
      }),
    },
    {
      service: 'Upstash Redis',
      tier: 'customer-flow',
      request: { endpoint: upstashUrl ? `${upstashUrl}/ping` : null, configured: Boolean(upstashUrl && upstashToken) },
      run: configured(
        upstashUrl && upstashToken ? upstashToken : undefined,
        'Upstash Redis is not configured',
        async () => responseResult(
          await fetch(`${upstashUrl}/ping`, {
            headers: { Authorization: `Bearer ${upstashToken}` },
            signal: AbortSignal.timeout(3_000),
          }),
          'Redis reachable',
        ),
      ),
    },
    {
      service: 'Serper',
      tier: 'back-office',
      request: { endpoint: 'https://google.serper.dev/account', configured: Boolean(serperKey) },
      run: configured(serperKey, 'Serper is not configured', async () =>
        responseResult(
          await fetch('https://google.serper.dev/account', {
            headers: { 'X-API-KEY': serperKey! },
            signal: AbortSignal.timeout(5_000),
          }),
        ),
      ),
    },
    {
      service: 'DeepSeek',
      tier: 'back-office',
      request: { endpoint: 'https://api.deepseek.com/user/balance', configured: Boolean(deepSeekKey) },
      run: configured(deepSeekKey, 'DeepSeek is not configured', async () =>
        responseResult(
          await fetch('https://api.deepseek.com/user/balance', {
            headers: { Authorization: `Bearer ${deepSeekKey}` },
            signal: AbortSignal.timeout(3_000),
          }),
        ),
      ),
    },
    {
      service: 'OpenAI',
      tier: 'back-office',
      request: { endpoint: 'https://api.openai.com/v1/models', configured: Boolean(openAiKey) },
      run: configured(openAiKey, 'OpenAI is not configured', async () =>
        responseResult(
          await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${openAiKey}` },
            signal: AbortSignal.timeout(3_000),
          }),
        ),
      ),
    },
  ]
}
