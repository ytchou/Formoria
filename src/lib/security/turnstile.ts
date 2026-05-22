export interface TurnstileResult {
  success: boolean
  errorCodes?: string[]
}

interface TurnstileApiResponse {
  success: boolean
  'error-codes'?: string[]
}

export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string
): Promise<TurnstileResult> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY

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
