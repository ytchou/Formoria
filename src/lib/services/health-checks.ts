import { resolveSentryProject } from '@/lib/services/sentry'
import { createServiceClient } from '@/lib/supabase/server'

export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unconfigured'

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

export async function checkSupabase(): Promise<ServiceHealthResult> {
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

export async function checkSentry(): Promise<ServiceHealthResult> {
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

export async function checkResend(): Promise<ServiceHealthResult> {
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

export async function checkUpstashRedis(): Promise<ServiceHealthResult> {
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
      return result('Upstash Redis', 'down', `連線失敗: ${response.statusText}`)
    }

    return latencyMs < 500
      ? result('Upstash Redis', 'healthy', `已連線 (${latencyMs}ms)`)
      : result('Upstash Redis', 'degraded', `已連線，延遲較高 (${latencyMs}ms)`)
  } catch (error) {
    return result(
      'Upstash Redis',
      'down',
      `連線錯誤: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

export async function checkTurnstile(): Promise<ServiceHealthResult> {
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

export async function checkTally(): Promise<ServiceHealthResult> {
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

export async function checkRailway(): Promise<ServiceHealthResult> {
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

const serviceNames = [
  'Supabase',
  'Sentry',
  'Resend',
  'Upstash Redis',
  'Turnstile',
  'Tally',
  'Railway',
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
