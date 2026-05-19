import { describe, it, expect } from 'vitest'

describe('AdminPage', () => {
  it('should export a default function', async () => {
    const mod = await import('../page')
    expect(typeof mod.default).toBe('function')
  })
})
