// @vitest-environment jsdom
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
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
  brandName: 'Brand One',
  brandSlug: 'brand-one',
  mitStatus: 'unverified' as const,
  isOwner: true,
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('InlineVerification hydration', () => {
  it('hydrates without a mismatch when verification was previously dismissed', async () => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(<InlineVerification {...props} />)
    localStorage.setItem('formoria:dismiss-verification:brand-1', '1')
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
