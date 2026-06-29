import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('getRenderProvider', () => {
  it('returns a provider with fetchRendered', async () => {
    const { getRenderProvider } = await import('../index')
    expect(getRenderProvider()).toHaveProperty('fetchRendered')
  })
})
