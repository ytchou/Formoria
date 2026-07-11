// @vitest-environment jsdom
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InlineVerification } from './inline-verification'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/app/[locale]/(protected)/dashboard/actions', () => ({
  verifyMitAction: vi.fn(),
}))

const props = {
  brandId: 'brand-1',
  mitStatus: 'unverified' as const,
}

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('InlineVerification hydration', () => {
  it('renders nothing on the server, then without a nested card when embedded', () => {
    expect(renderToString(<InlineVerification {...props} embedded />)).toBe('')

    const { container } = render(<InlineVerification {...props} embedded />)

    const verification = container.querySelector('#verification')
    expect(verification).not.toBeNull()
    expect(verification).not.toHaveClass('border')
  })

  it('hydrates without a mismatch when verification was previously dismissed', async () => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(<InlineVerification {...props} />)
    window.localStorage.setItem('formoria:dismiss-verification:brand-1', '1')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    let root: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(container, <InlineVerification {...props} />)
    })

    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).includes('Hydration failed'),
      ),
    ).toBe(false)
    expect(container.querySelector('#verification')).toBeNull()

    await act(async () => root.unmount())
  })
})
