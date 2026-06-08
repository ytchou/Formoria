// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import zh from '../../../../messages/zh-TW.json'

const mockSubmitClaimAction = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/zh-TW/brands/test-brand',
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} }),
  redirect: () => {},
  permanentRedirect: () => {},
}))

vi.mock('@/app/[locale]/brands/[slug]/actions', () => ({
  submitClaimAction: (...args: unknown[]) => mockSubmitClaimAction(...args),
}))

import { ClaimBrandCta } from '../claim-brand-cta'

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe('ClaimBrandCta', () => {
  beforeEach(() => {
    mockSubmitClaimAction.mockReset()
    mockSubmitClaimAction.mockResolvedValue({ ok: true })
  })

  it('renders the claim CTA for an unclaimed brand and submits the selected proof type', async () => {
    const user = userEvent.setup()

    renderWithIntl(<ClaimBrandCta brandId="brand-1" />)

    await user.click(screen.getByRole('button', { name: /認領這個品牌/i }))
    await user.selectOptions(screen.getByLabelText(/證明類型/i), 'social_post')
    await user.click(screen.getByRole('button', { name: /提交認領/i }))

    await waitFor(() => {
      expect(mockSubmitClaimAction).toHaveBeenCalledWith(
        expect.objectContaining({
          brandId: 'brand-1',
          proofType: 'social_post',
        })
      )
    })
  })
})
