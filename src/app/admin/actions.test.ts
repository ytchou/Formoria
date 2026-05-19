import { describe, it, expect } from 'vitest'

describe('admin actions module', () => {
  it('exports all required action functions', async () => {
    const mod = await import('./actions')

    expect(typeof mod.approveSubmissionAction).toBe('function')
    expect(typeof mod.rejectSubmissionAction).toBe('function')
    expect(typeof mod.updateBrandAction).toBe('function')
    expect(typeof mod.hideBrandAction).toBe('function')
    expect(typeof mod.unhideBrandAction).toBe('function')
    expect(typeof mod.deleteBrandAction).toBe('function')
    expect(typeof mod.createTagAction).toBe('function')
    expect(typeof mod.renameTagAction).toBe('function')
    expect(typeof mod.mergeTagAction).toBe('function')
    expect(typeof mod.deactivateTagAction).toBe('function')
  })
})
