// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UrlStep } from './UrlStep'

describe('UrlStep', () => {
  const defaultProps = {
    onSuccess: vi.fn(),
    onSkip: vi.fn(),
  }

  it('renders URL input and fetch button', () => {
    render(<UrlStep {...defaultProps} />)

    expect(screen.getByLabelText(/website url/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /fetch brand info/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/skip and fill manually/i)).toBeInTheDocument()
  })

  it('disables fetch button when URL is empty', () => {
    render(<UrlStep {...defaultProps} />)

    expect(
      screen.getByRole('button', { name: /fetch brand info/i })
    ).toBeDisabled()
  })

  it('enables fetch button when valid URL is entered', async () => {
    const user = userEvent.setup()
    render(<UrlStep {...defaultProps} />)

    await user.type(
      screen.getByLabelText(/website url/i),
      'https://mybrand.com'
    )

    expect(
      screen.getByRole('button', { name: /fetch brand info/i })
    ).toBeEnabled()
  })

  it('shows loading state when fetching', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    )
    render(<UrlStep {...defaultProps} />)

    await user.type(
      screen.getByLabelText(/website url/i),
      'https://mybrand.com'
    )
    await user.click(screen.getByRole('button', { name: /fetch brand info/i }))

    expect(screen.getByText(/fetching brand info/i)).toBeInTheDocument()
  })

  it('calls onSuccess with scraped data on successful fetch', async () => {
    const user = userEvent.setup()
    const mockData = { brandName: 'Test', websiteUrl: 'https://mybrand.com' }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      })
    )

    render(<UrlStep {...defaultProps} />)
    await user.type(
      screen.getByLabelText(/website url/i),
      'https://mybrand.com'
    )
    await user.click(screen.getByRole('button', { name: /fetch brand info/i }))

    await waitFor(() => {
      expect(defaultProps.onSuccess).toHaveBeenCalledWith(mockData)
    })
  })

  it('shows error state on fetch failure', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal error' }),
      })
    )

    render(<UrlStep {...defaultProps} />)
    await user.type(
      screen.getByLabelText(/website url/i),
      'https://mybrand.com'
    )
    await user.click(screen.getByRole('button', { name: /fetch brand info/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/could not fetch brand info/i)
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('calls onSkip when skip link is clicked', async () => {
    const user = userEvent.setup()
    render(<UrlStep {...defaultProps} />)

    await user.click(screen.getByText(/skip and fill manually/i))

    expect(defaultProps.onSkip).toHaveBeenCalled()
  })
})
