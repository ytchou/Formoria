import { describe, it, expect, beforeEach } from 'vitest'
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
