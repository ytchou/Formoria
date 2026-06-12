import { describe, it, expect } from 'vitest'
import { runtime, alt } from '@/app/[locale]/og/trust/opengraph-image'

describe('Trust OG image route', () => {
  it('exports edge runtime', () => {
    expect(runtime).toBe('edge')
  })

  it('exports alt text', () => {
    expect(typeof alt).toBe('string')
    expect(alt.length).toBeGreaterThan(0)
  })
})
