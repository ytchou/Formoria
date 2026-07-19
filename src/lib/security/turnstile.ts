export interface TurnstileResult {
  success: boolean
  errorCodes?: string[]
}

interface TurnstileApiResponse {
  success?: unknown
  'error-codes'?: unknown
}

const TURNSTILE_VERIFY_TIMEOUT_MS = 10_000

function isLocalDevHost(requestHost?: string): boolean {
  if (process.env.NODE_ENV === 'production' || !requestHost) return false

  const host = requestHost.toLowerCase()
  if (host === '::1' || host.startsWith('[::1]')) return true

  const hostname = host.split(':')[0]
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string,
  requestHost?: string
): Promise<TurnstileResult> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY

  if (process.env.PLAYWRIGHT_TEST === 'true') {
    return { success: true }
  }

  if (isLocalDevHost(requestHost)) {
    return { success: true }
  }

  // If no secret key is set, skip verification (dev mode)
  if (!secretKey) {
    console.warn('[Turnstile] TURNSTILE_SECRET_KEY is not set — skipping verification (dev mode)')
    return { success: true }
  }

  const startedAt = Date.now()
  const requestPayload = {
    tokenLength: token.length,
    remoteIpProvided: Boolean(remoteIp),
    requestHost: requestHost ?? null,
  }

  try {
    const body = new URLSearchParams({
      secret: secretKey,
      response: token,
    })

    if (remoteIp) {
      body.set('remoteip', remoteIp)
    }

    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(TURNSTILE_VERIFY_TIMEOUT_MS),
      }
    )

    const data = (await response.json()) as TurnstileApiResponse
    const success = response.ok && data.success === true
    const errorCodes = Array.isArray(data['error-codes'])
      ? data['error-codes'].filter((code): code is string => typeof code === 'string')
      : undefined
    console.info('[turnstile:audit]', {
      request: requestPayload,
      response: {
        httpStatus: response.status,
        success,
        errorCodes: errorCodes ?? [],
      },
      latencyMs: Date.now() - startedAt,
      status: success ? 'success' : response.ok ? 'rejected' : 'provider_error',
    })

    return {
      success,
      errorCodes,
    }
  } catch (error) {
    console.info('[turnstile:audit]', {
      request: requestPayload,
      response: {
        error: error instanceof Error ? error.name : 'UnknownError',
      },
      latencyMs: Date.now() - startedAt,
      status: 'network_error',
    })
    return { success: false, errorCodes: ['network-error'] }
  }
}
