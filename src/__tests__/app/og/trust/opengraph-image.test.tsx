import { describe, it, expect } from 'vitest'
import OgImage, { alt } from '@/app/[locale]/og/trust/opengraph-image'

describe('Trust OG image route', () => {
  it('exports default image generator', () => {
    expect(typeof OgImage).toBe('function')
  })

  it('exports alt text', () => {
    expect(typeof alt).toBe('string')
    expect(alt.length).toBeGreaterThan(0)
  })
})
