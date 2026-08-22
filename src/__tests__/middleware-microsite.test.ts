import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

function req(host: string, path: string) {
  return new NextRequest(new URL(`https://${host}${path}`), {
    headers: { host },
  })
}

describe('microsite host rewrite', () => {
  beforeEach(() => { process.env.MICROSITE_HOST = 'brand.formoria.com' })

  it('rewrites brand.formoria.com/<slug> to /site/<slug>', async () => {
    const res = await proxy(req('brand.formoria.com', '/warmwood-living'))
    expect(res.headers.get('x-middleware-rewrite')).toContain('/site/warmwood-living')
  })

  it('does NOT rewrite the main host', async () => {
    const res = await proxy(req('formoria.com', '/warmwood-living'))
    expect(res.headers.get('x-middleware-rewrite') ?? '').not.toContain('/site/')
  })

  it('ignores non-slug paths on the microsite host', async () => {
    const res = await proxy(req('brand.formoria.com', '/_next/static/x.js'))
    expect(res.headers.get('x-middleware-rewrite') ?? '').not.toContain('/site/')
  })
})

/**
 * DEV-1551. The microsite branch is terminal -- it rewrites or returns for
 * every request on MICROSITE_HOST -- and the Cloudflare origin guard used to
 * sit BELOW it, so a request that simply claimed `Host: brand.formoria.com`
 * reached the origin with no edge credential and got the microsite surface
 * unguarded. The guard now runs first.
 */
describe('origin guard ordering against the microsite host', () => {
  beforeEach(() => {
    process.env.MICROSITE_HOST = 'brand.formoria.com'
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CF_ORIGIN_SECRET', 'edge-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('origin guard rejects a microsite Host without the edge header', async () => {
    const res = await proxy(req('brand.formoria.com', '/warmwood-living'))

    expect(res.status).toBe(403)
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('still rewrites the microsite host when the edge header is present', async () => {
    const res = await proxy(
      new NextRequest(new URL('https://brand.formoria.com/warmwood-living'), {
        headers: {
          host: 'brand.formoria.com',
          'x-formoria-edge': 'edge-secret',
        },
      }),
    )

    expect(res.headers.get('x-middleware-rewrite')).toContain('/site/warmwood-living')
  })
})
