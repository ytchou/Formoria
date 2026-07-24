import { signCookieValue, verifyCookieValue } from './cookie-signing'

export const BRAND_LIKE_VISITOR_COOKIE = 'fm_like_visitor'
export const BRAND_LIKE_VISITOR_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 365,
  path: '/',
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const encoder = new TextEncoder()

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(buffer),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}

let cachedSecret: string | null = null

async function getBrandLikeSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret

  const secret = process.env.CHALLENGE_SECRET
  if (!secret) throw new Error('CHALLENGE_SECRET is required')

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode('brand-likes'),
  )

  cachedSecret = bytesToHex(digest)
  return cachedSecret
}

export async function signBrandLikeVisitorId(visitorId: string): Promise<string> {
  if (!UUID_PATTERN.test(visitorId)) throw new Error('Invalid brand-like visitor ID')
  return signCookieValue(visitorId, await getBrandLikeSecret())
}

export async function verifyBrandLikeVisitorId(
  signedValue: string | null | undefined,
): Promise<string | null> {
  if (!signedValue) return null

  const visitorId = await verifyCookieValue(signedValue, await getBrandLikeSecret())
  return visitorId && UUID_PATTERN.test(visitorId) ? visitorId : null
}

export async function hashBrandLikeVisitorId(visitorId: string): Promise<string> {
  if (!UUID_PATTERN.test(visitorId)) throw new Error('Invalid brand-like visitor ID')
  return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(visitorId)))
}
