import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  getBrandLikeState: vi.fn(),
  setBrandLike: vi.fn(),
  hashVisitorId: vi.fn(),
  signVisitorId: vi.fn(),
  verifyVisitorId: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: mocks.cookieGet,
    set: mocks.cookieSet,
  })),
  headers: vi.fn(async () => new Map([['x-forwarded-for', '192.0.2.1']])),
}))

vi.mock('@/lib/security/rate-limiter', () => ({
  rateLimit: mocks.rateLimit,
}))

vi.mock('@/lib/security/brand-like-identity', () => ({
  BRAND_LIKE_VISITOR_COOKIE: 'fm_like_visitor',
  BRAND_LIKE_VISITOR_COOKIE_OPTIONS: { httpOnly: true, path: '/' },
  hashBrandLikeVisitorId: mocks.hashVisitorId,
  signBrandLikeVisitorId: mocks.signVisitorId,
  verifyBrandLikeVisitorId: mocks.verifyVisitorId,
}))

vi.mock('@/lib/services/brand-likes', () => ({
  getBrandLikeState: mocks.getBrandLikeState,
  setBrandLike: mocks.setBrandLike,
}))

import {
  getBrandLikeStateAction,
  setBrandLikeAction,
} from './brand-likes'

const BRAND_ID = 'd9428888-122b-4e1f-b85c-61c0a8904d6a'
const VISITOR_ID = '7b5851e2-57c6-4e36-8d90-0406e5045d62'
const VISITOR_HASH = 'a'.repeat(64)

describe('brand-like actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.verifyVisitorId.mockResolvedValue(null)
    mocks.hashVisitorId.mockResolvedValue(VISITOR_HASH)
    mocks.signVisitorId.mockResolvedValue('signed-visitor')
    mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 })
    mocks.getBrandLikeState.mockResolvedValue({ count: 4, liked: false })
    mocks.setBrandLike.mockResolvedValue({ count: 5, liked: true })
  })

  it('rejects malformed brand IDs before reading the service', async () => {
    await expect(getBrandLikeStateAction('not-a-uuid')).resolves.toEqual({
      ok: false,
      error: 'invalid_brand',
    })
    expect(mocks.getBrandLikeState).not.toHaveBeenCalled()
  })

  it('reads the public count and this signed browser state', async () => {
    mocks.cookieGet.mockReturnValue({ value: 'signed-visitor' })
    mocks.verifyVisitorId.mockResolvedValue(VISITOR_ID)
    mocks.getBrandLikeState.mockResolvedValue({ count: 8, liked: true })

    await expect(getBrandLikeStateAction(BRAND_ID)).resolves.toEqual({
      ok: true,
      count: 8,
      liked: true,
    })
    expect(mocks.getBrandLikeState).toHaveBeenCalledWith(BRAND_ID, VISITOR_HASH)
  })

  it('creates a signed browser identity on the first like', async () => {
    const randomUuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(VISITOR_ID)

    await expect(setBrandLikeAction(BRAND_ID, true)).resolves.toEqual({
      ok: true,
      count: 5,
      liked: true,
    })
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'fm_like_visitor',
      'signed-visitor',
      expect.objectContaining({ httpOnly: true }),
    )
    expect(mocks.setBrandLike).toHaveBeenCalledWith(
      BRAND_ID,
      VISITOR_HASH,
      true,
    )

    randomUuid.mockRestore()
  })

  it('rate-limits mutations before creating an identity', async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 1 })

    await expect(setBrandLikeAction(BRAND_ID, true)).resolves.toEqual({
      ok: false,
      error: 'rate_limited',
    })
    expect(mocks.cookieSet).not.toHaveBeenCalled()
    expect(mocks.setBrandLike).not.toHaveBeenCalled()
  })

  it('maps rate limiter failures to an unavailable result', async () => {
    mocks.rateLimit.mockRejectedValue(new Error('rate limiter unavailable'))

    await expect(setBrandLikeAction(BRAND_ID, true)).resolves.toEqual({
      ok: false,
      error: 'unavailable',
    })
    expect(mocks.cookieSet).not.toHaveBeenCalled()
    expect(mocks.setBrandLike).not.toHaveBeenCalled()
  })
})
