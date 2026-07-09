import { createDeepSeekClient } from '@/lib/services/deepseek-client'
import { resolveSentryProject } from '@/lib/services/sentry'
import { createServiceClient } from '@/lib/supabase/server'

type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unconfigured'

export interface ServiceHealthResult {
  service: string
  status: HealthStatus
  message: string
  checkedAt: string
}

type TallySubmission = {
  created_at: string | null
}

const checkedAt = () => new Date().toISOString()

const result = (
  service: string,
  status: HealthStatus,
  message: string
): ServiceHealthResult => ({
  service,
  status,
  message,
  checkedAt: checkedAt(),
})

async function checkSupabase(): Promise<ServiceHealthResult> {
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('brands').select('id').limit(1)

    if (error) {
      return result('Supabase', 'down', error.message)
    }

    return result('Supabase', 'healthy', 'Connection healthy')
  } catch (error) {
    return result('Supabase', 'down', error instanceof Error ? error.message : 'Unknown error')
  }
}

async function checkSentry(): Promise<ServiceHealthResult> {
  const token = process.env.SENTRY_AUTH_TOKEN

  if (!token) {
    return result('Sentry', 'unconfigured', 'SENTRY_AUTH_TOKEN is not configured')
  }

  try {
    const { org, project } = await resolveSentryProject(token)
    const response = await fetch(
      `https://sentry.io/api/0/projects/${org}/${project}/user-feedback/?limit=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(3000),
      }
    )

    return response.ok
      ? result('Sentry', 'healthy', 'API reachable')
      : result('Sentry', 'down', `API returned ${response.status}`)
  } catch (error) {
    return result('Sentry', 'down', error instanceof Error ? error.message : 'Unknown error')
  }
}

async function checkResend(): Promise<ServiceHealthResult> {
  const { RESEND_API_KEY } = process.env

  if (!RESEND_API_KEY) {
    return result('Resend', 'unconfigured', 'Resend API key is not configured')
  }

  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      signal: AbortSignal.timeout(3000),
    })

    return response.ok
      ? result('Resend', 'healthy', 'API reachable')
      : result('Resend', 'down', `API returned ${response.status}`)
  } catch (error) {
    return result('Resend', 'down', error instanceof Error ? error.message : 'Unknown error')
  }
}

async function checkUpstashRedis(): Promise<ServiceHealthResult> {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    return result('Upstash Redis', 'unconfigured', 'Upstash Redis is not configured')
  }

  try {
    const start = performance.now()
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}/ping`, {
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      },
      signal: AbortSignal.timeout(3000),
    })
    const latencyMs = Math.round(performance.now() - start)

    if (!response.ok) {
      return result('Upstash Redis', 'down', `Connection failed: ${response.statusText}`)
    }

    return latencyMs < 500
      ? result('Upstash Redis', 'healthy', `Connected (${latencyMs}ms)`)
      : result('Upstash Redis', 'degraded', `Connected, high latency (${latencyMs}ms)`)
  } catch (error) {
    return result(
      'Upstash Redis',
      'down',
      `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

async function checkTurnstile(): Promise<ServiceHealthResult> {
  const { TURNSTILE_SECRET_KEY } = process.env

  if (!TURNSTILE_SECRET_KEY) {
    return result('Turnstile', 'unconfigured', 'Turnstile secret key is not configured')
  }

  try {
    const formData = new FormData()
    formData.append('secret', TURNSTILE_SECRET_KEY)
    formData.append('response', '')

    await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(3000),
    })

    return result('Turnstile', 'healthy', 'API reachable')
  } catch (error) {
    return result('Turnstile', 'down', error instanceof Error ? error.message : 'Unknown error')
  }
}

async function checkTally(): Promise<ServiceHealthResult> {
  try {
    const supabase = createServiceClient()
    const query = supabase
      .from('feedback')
      .select('created_at')
      .not('tally_response_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)

    const { data, error } = (await query) as {
      data: TallySubmission[] | null
      error: { message: string } | null
    }

    if (error) {
      return result('Tally', 'down', error.message)
    }

    const latestSubmission = data?.[0]

    if (!latestSubmission?.created_at) {
      return result('Tally', 'healthy', 'No submissions yet')
    }

    const ageMs = Date.now() - new Date(latestSubmission.created_at).getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)

    if (ageDays < 30) {
      return result('Tally', 'healthy', 'Recent submissions found')
    }

    if (ageDays <= 90) {
      return result('Tally', 'degraded', 'No submissions in the last 30 days')
    }

    return result('Tally', 'down', 'No submissions in the last 90 days')
  } catch (error) {
    return result('Tally', 'down', error instanceof Error ? error.message : 'Unknown error')
  }
}

async function checkRailway(): Promise<ServiceHealthResult> {
  const { NEXT_PUBLIC_SITE_URL } = process.env

  if (!NEXT_PUBLIC_SITE_URL) {
    return result('Railway', 'unconfigured', 'Site URL is not configured')
  }

  try {
    const response = await fetch(NEXT_PUBLIC_SITE_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000),
    })

    return response.ok
      ? result('Railway', 'healthy', 'Site reachable')
      : result('Railway', 'down', `Site returned ${response.status}`)
  } catch (error) {
    return result('Railway', 'down', error instanceof Error ? error.message : 'Unknown error')
  }
}

async function checkSerper(): Promise<ServiceHealthResult> {
  const apiKey = process.env.SERPER_API_KEY

  if (!apiKey) {
    return result('Serper', 'unconfigured', 'SERPER_API_KEY is not configured')
  }

  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: 'test', num: 1, gl: 'tw', hl: 'zh-TW' }),
      signal: AbortSignal.timeout(5000),
    })

    return response.ok
      ? result('Serper', 'healthy', 'API reachable')
      : result('Serper', 'down', `API returned ${response.status}`)
  } catch (error) {
    return result('Serper', 'down', error instanceof Error ? error.message : 'Unknown error')
  }
}

async function checkDeepSeek(): Promise<ServiceHealthResult> {
  const { DEEPSEEK_API_KEY } = process.env

  if (!DEEPSEEK_API_KEY) {
    return result('DeepSeek', 'unconfigured', 'DEEPSEEK_API_KEY is not configured')
  }

  try {
    const client = createDeepSeekClient({ apiKey: DEEPSEEK_API_KEY })
    const response = await client.balance(3000)

    if (!response.ok) {
      return result('DeepSeek', 'down', `API returned ${response.status}`)
    }

    const balance = await response.json()
    const balanceInfo =
      balance.balance_infos.find((info: { currency: string }) => info.currency === 'USD') ??
      balance.balance_infos[0]
    const remaining = Number.parseFloat(balanceInfo.total_balance)

    if (balance.is_available === false || remaining === 0) {
      return result('DeepSeek', 'down', `$${remaining.toFixed(2)} remaining`)
    }

    if (remaining <= 1 && remaining > 0) {
      return result('DeepSeek', 'degraded', `$${remaining.toFixed(2)} remaining`)
    }

    return result('DeepSeek', 'healthy', `$${remaining.toFixed(2)} remaining`)
  } catch (error) {
    return result('DeepSeek', 'down', error instanceof Error ? error.message : 'Unknown error')
  }
}

const serviceNames = [
  'Supabase',
  'Sentry',
  'Resend',
  'Upstash Redis',
  'Turnstile',
  'Tally',
  'Railway',
  'Serper',
  'DeepSeek',
] as const

export async function checkAllServices(): Promise<ServiceHealthResult[]> {
  const checks = await Promise.allSettled([
    checkSupabase(),
    checkSentry(),
    checkResend(),
    checkUpstashRedis(),
    checkTurnstile(),
    checkTally(),
    checkRailway(),
    checkSerper(),
    checkDeepSeek(),
  ])

  return checks.map((check, index) =>
    check.status === 'fulfilled'
      ? check.value
      : result(
          serviceNames[index] ?? 'Unknown',
          'down',
          check.reason instanceof Error ? check.reason.message : 'Unknown error'
        )
  )
}
