/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnstileWidget } from './TurnstileWidget'

const mockScriptProps = vi.hoisted(() => vi.fn())

vi.mock('next/script', () => ({
  default: (props: { onError?: () => void; strategy?: string }) => {
    mockScriptProps(props)
    return (
      <button type="button" onClick={props.onError}>
        Fail script load
      </button>
    )
  },
}))

describe('TurnstileWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'production-site-key')
    delete window.turnstile
  })

  it('loads as an interactive dependency and reports script failures', () => {
    const onError = vi.fn()
    render(<TurnstileWidget onSuccess={vi.fn()} onError={onError} />)

    expect(mockScriptProps).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: 'afterInteractive' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fail script load' }))
    expect(onError).toHaveBeenCalledOnce()
  })
})
