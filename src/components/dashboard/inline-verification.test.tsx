// @vitest-environment jsdom
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InlineVerification } from './inline-verification'

const translations: Record<string, string> = {
  'declare.scopeLabel': '聲明範圍',
  'declare.attestation': '我確認上述產品在台灣製造',
  'declare.submit': '送出聲明',
  'declared.withdraw': '撤回聲明',
}

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => translations[key] ?? key,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'test-brand' }),
}))

vi.mock('@/app/[locale]/(protected)/dashboard/actions', () => ({
  verifyMitAction: vi.fn(),
}))

vi.mock('@/app/[locale]/(protected)/dashboard/brands/[slug]/actions', () => ({
  declareMitAction: vi.fn(),
  withdrawDeclarationAction: vi.fn(),
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

describe('InlineVerification MIT declaration', () => {
  it('offers declaration scope and gates submission on attestation', () => {
    render(<InlineVerification {...props} embedded />)

    expect(screen.getByLabelText('聲明範圍')).toBeInTheDocument()
    const attestation = screen.getByRole('checkbox', { name: /我確認/ })
    const submit = screen.getByRole('button', { name: '送出聲明' })

    expect(submit).toBeDisabled()
    fireEvent.click(attestation)
    expect(submit).toBeEnabled()
  })

  it('shows withdrawal for a declared brand', () => {
    render(
      <InlineVerification
        {...props}
        embedded
        mitStatus="declared"
        mitDeclaredScope="most"
        mitDeclaredAt="2026-07-22T00:00:00.000Z"
      />,
    )

    expect(screen.getByRole('button', { name: '撤回聲明' })).toBeInTheDocument()
  })
})
