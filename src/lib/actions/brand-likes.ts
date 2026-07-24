'use server'

import { cookies, headers } from 'next/headers'
import { z } from 'zod/v3'

import { rateLimit } from '@/lib/security/rate-limiter'
import {
  BRAND_LIKE_VISITOR_COOKIE,
  BRAND_LIKE_VISITOR_COOKIE_OPTIONS,
  hashBrandLikeVisitorId,
  signBrandLikeVisitorId,
  verifyBrandLikeVisitorId,
} from '@/lib/security/brand-like-identity'
import {
  getBrandLikeState,
  setBrandLike,
  type BrandLikeState,
} from '@/lib/services/brand-likes'

const brandIdSchema = z.string().uuid()
const LIKE_RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 } as const

export type BrandLikeActionResult =
  | ({ ok: true } & BrandLikeState)
  | { ok: false; error: 'invalid_brand' | 'rate_limited' | 'unavailable' }

async function readVisitorId(): Promise<string | null> {
  const cookieStore = await cookies()
  return verifyBrandLikeVisitorId(
    cookieStore.get(BRAND_LIKE_VISITOR_COOKIE)?.value,
  )
}

async function getRequestIp(): Promise<string> {
  const headerList = await headers()
  return (
    headerList.get('cf-connecting-ip') ??
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    'unknown'
  )
}

export async function getBrandLikeStateAction(
  brandId: string,
): Promise<BrandLikeActionResult> {
  const parsedBrandId = brandIdSchema.safeParse(brandId)
  if (!parsedBrandId.success) return { ok: false, error: 'invalid_brand' }

  try {
    const visitorId = await readVisitorId()
    const visitorHash = visitorId
      ? await hashBrandLikeVisitorId(visitorId)
      : null
    const state = await getBrandLikeState(parsedBrandId.data, visitorHash)
    return { ok: true, ...state }
  } catch (error) {
    console.error('[brand-likes:get-state]', error)
    return { ok: false, error: 'unavailable' }
  }
}

export async function setBrandLikeAction(
  brandId: string,
  liked: boolean,
): Promise<BrandLikeActionResult> {
  const parsed = z.object({ brandId: brandIdSchema, liked: z.boolean() }).safeParse({
    brandId,
    liked,
  })
  if (!parsed.success) return { ok: false, error: 'invalid_brand' }

  try {
    const limit = await rateLimit(await getRequestIp(), {
      ...LIKE_RATE_LIMIT,
      prefix: 'brand-like',
    })
    if (!limit.allowed) return { ok: false, error: 'rate_limited' }

    const cookieStore = await cookies()
    let visitorId = await verifyBrandLikeVisitorId(
      cookieStore.get(BRAND_LIKE_VISITOR_COOKIE)?.value,
    )

    if (!visitorId) {
      if (!parsed.data.liked) {
        const state = await getBrandLikeState(parsed.data.brandId, null)
        return { ok: true, ...state }
      }

      visitorId = crypto.randomUUID()
      cookieStore.set(
        BRAND_LIKE_VISITOR_COOKIE,
        await signBrandLikeVisitorId(visitorId),
        BRAND_LIKE_VISITOR_COOKIE_OPTIONS,
      )
    }

    const state = await setBrandLike(
      parsed.data.brandId,
      await hashBrandLikeVisitorId(visitorId),
      parsed.data.liked,
    )
    return { ok: true, ...state }
  } catch (error) {
    console.error('[brand-likes:set-state]', error)
    return { ok: false, error: 'unavailable' }
  }
}
