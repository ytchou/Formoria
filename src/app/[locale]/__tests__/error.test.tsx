// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import ErrorBoundary from '../error'

describe('Error boundary', () => {
  it('renders hardcoded strings without NextIntlClientProvider', () => {
    const error = new Error('Test error')
    const reset = vi.fn()

    render(<ErrorBoundary error={error} reset={reset} />)

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })
})
