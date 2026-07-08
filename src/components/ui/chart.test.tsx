// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChartContainer } from './chart'

describe('ChartContainer', () => {
  it('does not initialize ResponsiveContainer with negative dimensions', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    render(
      <ChartContainer config={{ views: { color: '#000' } }}>
        <div />
      </ChartContainer>,
    )

    expect(warning.mock.calls.flat().join(' ')).not.toContain(
      'width(-1) and height(-1)',
    )
    warning.mockRestore()
  })
})
