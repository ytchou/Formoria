import { createHmac, timingSafeEqual } from 'node:crypto'

export function signCookieValue(value: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(value).digest('base64url')

  return `${value}.${signature}`
}

export function verifyCookieValue(signed: string, secret: string): string | null {
  if (!signed) return null

  const separatorIndex = signed.lastIndexOf('.')
  if (separatorIndex <= 0 || separatorIndex === signed.length - 1) return null

  const value = signed.slice(0, separatorIndex)
  const signature = signed.slice(separatorIndex + 1)
  const expectedSignature = createHmac('sha256', secret).update(value).digest()

  let actualSignature: Buffer
  try {
    actualSignature = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }

  if (actualSignature.length !== expectedSignature.length) return null

  return timingSafeEqual(actualSignature, expectedSignature) ? value : null
}
