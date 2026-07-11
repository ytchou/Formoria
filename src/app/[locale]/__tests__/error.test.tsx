// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, it, expect, vi } from 'vitest'
import messages from '@/../messages/en.json'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import ErrorBoundary from '../error'

describe('Error boundary', () => {
  it('renders translated title, description, and retry button', () => {
    const error = new Error('Test error')
    const reset = vi.fn()

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ErrorBoundary error={error} reset={reset} />
      </NextIntlClientProvider>,
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })
})
