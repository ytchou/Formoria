import { describe, it, expect } from 'vitest'
import { timePhase } from '../types'

describe('timePhase', () => {
  it('records duration and returns result for successful execution', async () => {
    const { result, durationMs } = await timePhase(async () => {
      return { changed: true, value: 42 }
    })
    expect(result).toEqual({ changed: true, value: 42 })
    expect(durationMs).toBeGreaterThanOrEqual(0)
    expect(typeof durationMs).toBe('number')
  })

  it('records duration even when function throws', async () => {
    expect.assertions(1)

    try {
      await timePhase(async () => { throw new Error('phase failed') })
    } catch (e) {
      expect((e as Error).message).toBe('phase failed')
    }
  })

  it('measures actual elapsed time', async () => {
    const { durationMs } = await timePhase(async () => {
      await new Promise((r) => setTimeout(r, 50))
      return 'done'
    })
    expect(durationMs).toBeGreaterThanOrEqual(40)
    expect(durationMs).toBeLessThan(500)
  })
})
