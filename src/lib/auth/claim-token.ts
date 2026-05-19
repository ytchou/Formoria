import { SignJWT, jwtVerify } from 'jose'

function getSecret(): Uint8Array {
  const secret = process.env.CLAIM_TOKEN_SECRET
  if (!secret) {
    throw new Error('CLAIM_TOKEN_SECRET environment variable is not set')
  }
  return new TextEncoder().encode(secret)
}

export async function generateClaimToken(
  brandId: string,
  email: string
): Promise<string> {
  const secret = getSecret()
  return new SignJWT({ brandId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
}

export async function verifyClaimToken(
  token: string
): Promise<{ brandId: string; email: string } | null> {
  try {
    const secret = getSecret()
    const { payload } = await jwtVerify(token, secret)
    const brandId = payload.brandId as string | undefined
    const email = payload.email as string | undefined
    if (!brandId || !email) return null
    return { brandId, email }
  } catch {
    return null
  }
}
