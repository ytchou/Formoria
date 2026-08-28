import { describe, expect, it } from 'vitest'
import { validateLocalRenderFlags } from './refresh-options'

describe('local refresh render mode', () => {
  it('allows local rendering for an in-process run', () => {
    expect(validateLocalRenderFlags(['--local-render', '--no-apply'])).toBe(
      true,
    )
  })

  it.each(['--via-worker', '--enqueue-only'])(
    'rejects --local-render with %s',
    (conflict) => {
      expect(() =>
        validateLocalRenderFlags(['--local-render', conflict]),
      ).toThrow('--local-render cannot be combined')
    },
  )
})
