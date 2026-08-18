// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import OgImage, { alt, size } from '@/app/[locale]/og/trust/opengraph-image'
import zhTW from '../../../../../messages/zh-TW.json'

const source = readFileSync(
  resolve(import.meta.dirname, '../../../../app/[locale]/og/trust/opengraph-image.tsx'),
  'utf8',
)

describe('Trust OG image route', () => {
  it('renders a 1200x630 PNG', async () => {
    const response = await OgImage({ params: Promise.resolve({ locale: 'zh-TW' }) })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/png')
    expect(size).toEqual({ width: 1200, height: 630 })
    expect(alt.length).toBeGreaterThan(0)
  })

  it('carries the trust commitment, not the positioning line', () => {
    // This route is the last consumer of `landing.trustSeam.line`, so the key
    // must exist and both the translated path and the literal fallback must
    // read it. The positioning line (`manifesto.headline`) held the same
    // string only while the trust seam replaced the manifesto band; a
    // positioning line is not a trust commitment.
    expect(zhTW.landing.trustSeam.line.length).toBeGreaterThan(0)
    expect(source).toContain('namespace: "landing.trustSeam"')
    expect(source).toContain('zhTW.landing.trustSeam.line')
    expect(source).toContain('en.landing.trustSeam.line')
  })
})
