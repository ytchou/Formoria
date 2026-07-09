export interface TurnstileResult {
  success: boolean
  errorCodes?: string[]
}

interface TurnstileApiResponse {
  success: boolean
  'error-codes'?: string[]
}

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

  if (isLocalDevHost(requestHost)) {
    return { success: true }
  }

  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.E2E_USER_EMAIL
  ) {
    return { success: true }
  }

  // If no secret key is set, skip verification (dev mode)
  if (!secretKey) {
    console.warn('[Turnstile] TURNSTILE_SECRET_KEY is not set — skipping verification (dev mode)')
    return { success: true }
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
      }
    )

    const data = (await response.json()) as TurnstileApiResponse

    return {
      success: data.success,
      errorCodes: data['error-codes'],
    }
  } catch {
    return { success: false, errorCodes: ['network-error'] }
  }
}
