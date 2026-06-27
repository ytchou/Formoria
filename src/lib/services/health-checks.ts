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

    return result('Supabase', 'healthy', '連線正常')
  } catch (error) {
    return result('Supabase', 'down', error instanceof Error ? error.message : '未知錯誤')
  }
}

export async function checkSentry(): Promise<ServiceHealthResult> {
  const token = process.env.SENTRY_AUTH_TOKEN

  if (!token) {
    return result('Sentry', 'unconfigured', '未設定 SENTRY_AUTH_TOKEN')
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
      ? result('Sentry', 'healthy', 'API 可連線')
      : result('Sentry', 'down', `API 回傳 ${response.status}`)
  } catch (error) {
    return result('Sentry', 'down', error instanceof Error ? error.message : '未知錯誤')
  }
}

export async function checkResend(): Promise<ServiceHealthResult> {
  const { RESEND_API_KEY } = process.env

  if (!RESEND_API_KEY) {
    return result('Resend', 'unconfigured', '未設定 Resend API 金鑰')
  }

  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      signal: AbortSignal.timeout(3000),
    })

    return response.ok
      ? result('Resend', 'healthy', 'API 可連線')
      : result('Resend', 'down', `API 回傳 ${response.status}`)
  } catch (error) {
    return result('Resend', 'down', error instanceof Error ? error.message : '未知錯誤')
  }
}

export async function checkUpstashRedis(): Promise<ServiceHealthResult> {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    return result('Upstash Redis', 'unconfigured', '未設定 Upstash Redis')
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
      return result('Upstash Redis', 'down', `連線失敗：${response.statusText}`)
    }

    return latencyMs < 500
      ? result('Upstash Redis', 'healthy', `已連線（${latencyMs}ms）`)
      : result('Upstash Redis', 'degraded', `已連線，延遲較高（${latencyMs}ms）`)
  } catch (error) {
    return result(
      'Upstash Redis',
      'down',
      `連線錯誤：${error instanceof Error ? error.message : '未知錯誤'}`
    )
  }
}

export async function checkTurnstile(): Promise<ServiceHealthResult> {
  const { TURNSTILE_SECRET_KEY } = process.env

  if (!TURNSTILE_SECRET_KEY) {
    return result('Turnstile', 'unconfigured', '未設定 Turnstile 密鑰')
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

    return result('Turnstile', 'healthy', 'API 可連線')
  } catch (error) {
    return result('Turnstile', 'down', error instanceof Error ? error.message : '未知錯誤')
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
      return result('Tally', 'healthy', '尚無提交記錄')
    }

    const ageMs = Date.now() - new Date(latestSubmission.created_at).getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)

    if (ageDays < 30) {
      return result('Tally', 'healthy', '有近期提交記錄')
    }

    if (ageDays <= 90) {
      return result('Tally', 'degraded', '過去 30 天無提交記錄')
    }

    return result('Tally', 'down', '過去 90 天無提交記錄')
  } catch (error) {
    return result('Tally', 'down', error instanceof Error ? error.message : '未知錯誤')
  }
}

export async function checkRailway(): Promise<ServiceHealthResult> {
  const { NEXT_PUBLIC_SITE_URL } = process.env

  if (!NEXT_PUBLIC_SITE_URL) {
    return result('Railway', 'unconfigured', '未設定網站 URL')
  }

  try {
    const response = await fetch(NEXT_PUBLIC_SITE_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000),
    })

    return response.ok
      ? result('Railway', 'healthy', '網站可連線')
      : result('Railway', 'down', `網站回傳 ${response.status}`)
  } catch (error) {
    return result('Railway', 'down', error instanceof Error ? error.message : '未知錯誤')
  }
}

export async function checkApify(): Promise<ServiceHealthResult> {
  const { APIFY_TOKEN } = process.env

  if (!APIFY_TOKEN) {
    return result('Apify', 'unconfigured', '未設定 APIFY_TOKEN')
  }

  try {
    const response = await fetch(
      `https://api.apify.com/v2/users/me/usage/monthly?token=${APIFY_TOKEN}`,
      {
        signal: AbortSignal.timeout(3000),
      }
    )

    if (!response.ok) {
      return result('Apify', 'down', `API 回傳 ${response.status}`)
    }

    const usage = await response.json()
    const spend = usage.data.totalUsageCreditsUsdAfterVolumeDiscount

    return result('Apify', 'healthy', `本週期已花費 $${spend.toFixed(2)}`)
  } catch (error) {
    return result('Apify', 'down', error instanceof Error ? error.message : '未知錯誤')
  }
}

export async function checkDeepSeek(): Promise<ServiceHealthResult> {
  const { DEEPSEEK_API_KEY } = process.env

  if (!DEEPSEEK_API_KEY) {
    return result('DeepSeek', 'unconfigured', '未設定 DEEPSEEK_API_KEY')
  }

  try {
    const response = await fetch('https://api.deepseek.com/user/balance', {
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      signal: AbortSignal.timeout(3000),
    })

    if (!response.ok) {
      return result('DeepSeek', 'down', `API 回傳 ${response.status}`)
    }

    const balance = await response.json()
    const balanceInfo =
      balance.balance_infos.find((info: { currency: string }) => info.currency === 'USD') ??
      balance.balance_infos[0]
    const remaining = Number.parseFloat(balanceInfo.total_balance)

    if (balance.is_available === false || remaining === 0) {
      return result('DeepSeek', 'down', `餘額 $${remaining.toFixed(2)}`)
    }

    if (remaining <= 1 && remaining > 0) {
      return result('DeepSeek', 'degraded', `餘額偏低 $${remaining.toFixed(2)}`)
    }

    return result('DeepSeek', 'healthy', `餘額 $${remaining.toFixed(2)}`)
  } catch (error) {
    return result('DeepSeek', 'down', error instanceof Error ? error.message : '未知錯誤')
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
  'Apify',
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
    checkApify(),
    checkDeepSeek(),
  ])

  return checks.map((check, index) =>
    check.status === 'fulfilled'
      ? check.value
      : result(
          serviceNames[index] ?? 'Unknown',
          'down',
          check.reason instanceof Error ? check.reason.message : '未知錯誤'
        )
  )
}
