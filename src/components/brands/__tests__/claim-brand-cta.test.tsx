// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, expect, it, vi } from 'vitest'
import messages from '@/../messages/zh-TW.json'
import { ClaimBrandCta } from '@/components/brands/claim-brand-cta'

const uploadMock = vi.fn()
const mockUploadConfigs: Array<{ bucket: string; path: string }> = []
const mockUser = { id: 'user-1' }

vi.mock('@/lib/auth/use-user', () => ({ useUser: () => ({ user: mockUser, loading: false }) }))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/upload/useImageUpload', () => ({
  useImageUpload: (config: { bucket: string; path: string }) => {
    mockUploadConfigs.push(config)
    return { upload: uploadMock, uploading: false, progress: 0, status: 'idle', key: null, url: null, error: null }
  },
}))
const submitClaimAction = vi.fn(async (input: unknown) => {
  void input
  return { ok: true }
})
vi.mock('@/app/[locale]/brands/[slug]/actions', () => ({ submitClaimAction: (...a: unknown[]) => submitClaimAction(a[0]) }))

const renderCta = () => render(
  <NextIntlClientProvider locale="zh-TW" messages={messages}>
    <ClaimBrandCta brandId="b1" />
  </NextIntlClientProvider>,
)

beforeEach(() => {
  uploadMock.mockReset()
  uploadMock.mockResolvedValue({ key: 'claim-proofs/user-1/b1/server.webp', url: null })
  mockUploadConfigs.length = 0
  submitClaimAction.mockClear()
})

it('disables submit until 2 proof types are selected', () => {
  renderCta()
  fireEvent.click(screen.getByText('認領這個品牌'))
  fireEvent.click(screen.getByLabelText('品牌網域信箱'))
  expect(screen.getByRole('button', { name: /送出認領申請/ })).toBeDisabled()
  fireEvent.click(screen.getByLabelText('商業登記文件'))
  expect(screen.queryByText(/需再選/)).not.toBeInTheDocument()
})

it('does not render the removed 備註 field or the MIT email line', () => {
  renderCta()
  fireEvent.click(screen.getByText('認領這個品牌'))
  expect(screen.queryByText('認領備註')).not.toBeInTheDocument()
  expect(screen.queryByText(/來信.*申請驗證/)).not.toBeInTheDocument()
})

it('submits the server-returned claim-proof image key after upload succeeds', async () => {
  renderCta()
  fireEvent.click(screen.getByText('認領這個品牌'))
  fireEvent.click(screen.getByLabelText('品牌網域信箱'))
  fireEvent.click(screen.getByLabelText('後台截圖'))

  const emailUrl = document.querySelector<HTMLInputElement>('#claim-domain_email-url')
  expect(emailUrl).not.toBeNull()
  fireEvent.change(emailUrl!, { target: { value: 'https://brand.example/proof' } })

  const backendInput = document.querySelector<HTMLInputElement>('#claim-backend_screenshot-image')
  expect(backendInput).not.toBeNull()
  fireEvent.change(backendInput!, {
    target: { files: [new File(['image'], 'proof.png', { type: 'image/png' })] },
  })

  await waitFor(() => {
    expect(uploadMock).toHaveBeenCalled()
  })
  expect(mockUploadConfigs).toContainEqual({ bucket: 'claim-proofs', path: 'user-1/b1' })

  fireEvent.click(screen.getByRole('button', { name: /送出認領申請/ }))

  await waitFor(() => {
    expect(submitClaimAction).toHaveBeenCalledWith(
      expect.objectContaining({
        proofs: expect.arrayContaining([
          expect.objectContaining({
            type: 'backend_screenshot',
            imageKey: 'claim-proofs/user-1/b1/server.webp',
          }),
        ]),
      })
    )
  })
})
