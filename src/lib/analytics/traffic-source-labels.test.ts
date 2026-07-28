import { describe, expect, it } from 'vitest'
import { outboundDestinationLabel } from './traffic-source-labels'

describe('outboundDestinationLabel', () => {
  it('shows user-facing platform names instead of provider keys', () => {
    const labels = {
      threads: 'Threads',
      instagram: 'Instagram',
      other: '其他',
    }

    expect(outboundDestinationLabel('threads', labels)).toBe('Threads')
    expect(outboundDestinationLabel('instagram', labels)).toBe('Instagram')
    expect(outboundDestinationLabel('unmapped', labels)).toBe('其他')
  })
})
