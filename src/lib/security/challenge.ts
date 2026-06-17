import { SignJWT, jwtVerify } from 'jose'

export const CHALLENGE_COOKIE_NAME = 'fm_verified'

const CHALLENGE_TTL_SECONDS = 3600

function getChallengeSecret(): Uint8Array {
  const secret = process.env.CHALLENGE_SECRET
  if (!secret) {
    throw new Error('CHALLENGE_SECRET is required')
  }

  return new TextEncoder().encode(secret)
}

export async function signChallengeToken(ip: string): Promise<string> {
  return new SignJWT({ ip })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(getChallengeSecret())
}

export async function verifyChallengeToken(token: string, ip: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getChallengeSecret())
    return payload.ip === ip
  } catch {
    return false
  }
}
