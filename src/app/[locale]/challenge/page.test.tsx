/**
 * @vitest-environment jsdom
 */
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zh from '../../../../messages/zh-TW.json'
import ChallengePage from './page'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams('returnTo=%2Fbrands%2Ftalkoo'),
}))

vi.mock('@/components/submit/TurnstileWidget', () => ({
  TurnstileWidget: ({
    onSuccess,
    onError,
  }: {
    onSuccess: (token: string) => void
    onError?: () => void
  }) => (
    <MockTurnstileWidget onSuccess={onSuccess} onError={onError} />
  ),
}))

function MockTurnstileWidget({
  onSuccess,
  onError,
}: {
  onSuccess: (token: string) => void
  onError?: () => void
}) {
  const [used, setUsed] = useState(false)

  return (
    <>
      <button
        type="button"
        disabled={used}
        onClick={() => {
          setUsed(true)
          onSuccess('verified-token')
        }}
      >
        Complete verification
      </button>
      <button type="button" onClick={onError}>
        Fail verification
      </button>
    </>
  )
}

describe('ChallengePage', () => {
  const originalLocation = window.location
  const hrefValues: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    hrefValues.length = 0
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ redirectTo: '/brands/talkoo' }),
    } as Response)

    delete (window as { location?: unknown }).location
    Object.defineProperty(window, 'location', {
      value: new Proxy(originalLocation, {
        set(_target, property, value) {
          if (property === 'href') hrefValues.push(value as string)
          return true
        },
        get(target, property) {
          if (property === 'href') return ''
          return Reflect.get(target, property)
        },
      }),
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })

  it('uses a full-page navigation after successful verification', async () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <ChallengePage />
      </NextIntlClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Complete verification' }))

    await waitFor(() => {
      expect(hrefValues).toContain('/brands/talkoo')
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('posts the token and return path with a request deadline', async () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <ChallengePage />
      </NextIntlClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Complete verification' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/challenge/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          token: 'verified-token',
          returnTo: '/brands/talkoo',
        }),
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('falls back to the home page when the server omits redirectTo', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response)
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <ChallengePage />
      </NextIntlClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Complete verification' }))

    await waitFor(() => expect(hrefValues).toContain('/'))
  })

  it.each([
    ['server rejection', { ok: false, json: async () => ({}) } as Response],
    ['malformed success response', { ok: true, json: async () => { throw new Error('bad json') } } as unknown as Response],
  ])('shows an error after %s', async (_label, response) => {
    vi.mocked(global.fetch).mockResolvedValueOnce(response)
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <ChallengePage />
      </NextIntlClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Complete verification' }))

    expect(await screen.findByText('驗證失敗，請再試一次。')).toBeInTheDocument()
    expect(hrefValues).toHaveLength(0)
  })

  it('shows an error when the verification request rejects', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('network unavailable'))
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <ChallengePage />
      </NextIntlClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Complete verification' }))

    expect(await screen.findByText('驗證失敗，請再試一次。')).toBeInTheDocument()
    expect(hrefValues).toHaveLength(0)
  })

  it('shows an error when Turnstile reports a widget failure', async () => {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <ChallengePage />
      </NextIntlClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fail verification' }))

    expect(screen.getByText('驗證失敗，請再試一次。')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('resets Turnstile so verification can be retried after server rejection', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redirectTo: '/brands/talkoo' }),
      } as Response)
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zh}>
        <ChallengePage />
      </NextIntlClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Complete verification' }))
    expect(await screen.findByText('驗證失敗，請再試一次。')).toBeInTheDocument()

    const retry = screen.getByRole('button', { name: 'Complete verification' })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)

    await waitFor(() => expect(hrefValues).toContain('/brands/talkoo'))
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
