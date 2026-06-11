import { describe, it, expect, beforeEach } from 'vitest'
import type { Brand } from '@/lib/types/brand'
import { isMicrositeEnabled, micrositeMetadata } from '@/app/(microsite)/site/[slug]/microsite-helpers'

describe('microsite helpers', () => {
  beforeEach(() => { process.env.MICROSITE_HOST = 'brand.formoria.com' })

  it('enables only approved brands that have site_content', () => {
    expect(isMicrositeEnabled({ status: 'approved', siteContent: { template: 'default' } } as Brand)).toBe(true)
    expect(isMicrositeEnabled({ status: 'approved', siteContent: null } as Brand)).toBe(false)
    expect(isMicrositeEnabled({ status: 'pending', siteContent: { template: 'default' } } as Brand)).toBe(false)
  })

  it('builds canonical/OG URLs from MICROSITE_HOST, not formoria.com', () => {
    const meta = micrositeMetadata({ name: 'X', slug: 'warmwood-living' } as Brand)
    expect(meta.alternates?.canonical).toContain('brand.formoria.com/warmwood-living')
    expect(meta.robots).toMatchObject({ index: false })
  })
})
