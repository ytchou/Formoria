// @vitest-environment jsdom
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, expect, it, vi } from 'vitest'
import messages from '@/../messages/zh-TW.json'
import { ClaimBrandCta } from '@/components/brands/claim-brand-cta'

const uploadMock = vi.fn()
const mockUploadConfigs: Array<{ bucket: string; path: string; acceptedTypes?: string[]; uploadFields?: Record<string, string> }> = []
let mockUser: { id: string } | null = { id: 'user-1' }
let mockHasOwnedBrand = false
const getPendingClaimStatusAction = vi.fn<() => Promise<boolean>>()

vi.mock('@/lib/auth/use-user', () => ({
  useUser: () => ({
    user: mockUser,
    loading: false,
    viewer: { hasOwnedBrand: mockHasOwnedBrand, isAdmin: false, impersonation: null },
    viewerLoading: false,
  }),
}))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  usePathname: () => '/brands/test-brand',
}))
vi.mock('@/components/upload/useImageUpload', () => ({
  useImageUpload: (config: { bucket: string; path: string; acceptedTypes?: string[]; uploadFields?: Record<string, string> }) => {
    mockUploadConfigs.push(config)
    return { upload: uploadMock, uploading: false, progress: 0, status: 'idle', key: null, url: null, error: null }
  },
}))
const submitClaimAction = vi.fn(async (input: unknown) => {
  void input
  return { ok: true }
})
vi.mock('@/app/[locale]/brands/[slug]/actions', () => ({
  getPendingClaimStatusAction: () => getPendingClaimStatusAction(),
  submitClaimAction: (...a: unknown[]) => submitClaimAction(a[0]),
}))

const renderCta = (props: Partial<React.ComponentProps<typeof ClaimBrandCta>> = {}) => render(
  <NextIntlClientProvider locale="zh-TW" messages={messages}>
    <ClaimBrandCta brandId="b1" {...props} />
  </NextIntlClientProvider>,
)

beforeEach(() => {
  mockUser = { id: 'user-1' }
  mockHasOwnedBrand = false
  getPendingClaimStatusAction.mockReset()
  getPendingClaimStatusAction.mockResolvedValue(false)
  uploadMock.mockReset()
  uploadMock.mockResolvedValue({ key: 'claim-proofs/user-1/b1/server.webp', url: null })
  mockUploadConfigs.length = 0
  submitClaimAction.mockClear()
})

it('shows a sign-in gate instead of the claim form when logged out', () => {
  mockUser = null

  renderCta()

  expect(screen.getByText('這是你的品牌嗎？')).toBeInTheDocument()
  const compactNotice = screen.getByText('這是你的品牌嗎？').closest('section')
  expect(compactNotice).not.toBeNull()
  expect(compactNotice!).toHaveClass('bg-background', 'p-4')
  expect(compactNotice!).not.toHaveClass('bg-card', 'p-5')
  expect(screen.getByText('請先登入後再提交認領申請')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '立即登入' })).toHaveAttribute(
    'href',
    '/auth/sign-in?next=%2Fbrands%2Ftest-brand',
  )
  expect(screen.queryByRole('button', { name: '認領這個品牌' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /送出認領申請/ })).not.toBeInTheDocument()
  expect(screen.queryByText('提交認領證明')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '為什麼要認領？了解好處' })).toHaveAttribute('href', '/faq#claim')
})

it('renders the pending state on load when the user already has a pending claim', async () => {
  getPendingClaimStatusAction.mockResolvedValueOnce(true)
  renderCta()

  expect(await screen.findByText('已收到你的認領申請')).toBeInTheDocument()
  expect(screen.getByText('我們會盡快審核你提交的擁有證明，並以 Email 通知你結果。')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '認領這個品牌' })).not.toBeInTheDocument()
  expect(screen.queryByText('提交認領證明')).not.toBeInTheDocument()
})

it('waits for the pending-claim check before enabling a new claim', async () => {
  let resolvePendingStatus: (pending: boolean) => void = () => {}
  getPendingClaimStatusAction.mockReturnValueOnce(
    new Promise((resolve) => {
      resolvePendingStatus = resolve
    }),
  )

  renderCta()

  expect(
    screen.queryByRole('button', { name: '認領這個品牌' }),
  ).not.toBeInTheDocument()

  await act(async () => resolvePendingStatus(false))

  expect(
    await screen.findByRole('button', { name: '認領這個品牌' }),
  ).toBeInTheDocument()
})

it('renders nothing and skips claim-status lookup for existing owners', () => {
  mockHasOwnedBrand = true
  const { container } = renderCta()

  expect(container).toBeEmptyDOMElement()
  expect(getPendingClaimStatusAction).not.toHaveBeenCalled()
})

it('renders a domain email input without URL or upload controls', async () => {
  renderCta()
  fireEvent.click(await screen.findByText('認領這個品牌'))
  fireEvent.click(screen.getByLabelText('品牌網域信箱'))
  expect(screen.getByRole('button', { name: /送出認領申請/ })).toBeDisabled()

  const emailInput = document.querySelector<HTMLInputElement>('#claim-domain_email-email')
  expect(emailInput).not.toBeNull()
  expect(emailInput?.type).toBe('email')
  expect(screen.queryByText('上傳截圖')).not.toBeInTheDocument()

  fireEvent.change(emailInput!, { target: { value: 'owner@brand.example' } })
  expect(screen.getByRole('button', { name: /送出認領申請/ })).toBeEnabled()
})

it('requires a valid email for domain email proof', async () => {
  renderCta()
  fireEvent.click(await screen.findByText('認領這個品牌'))
  fireEvent.click(screen.getByLabelText('品牌網域信箱'))

  const emailInput = document.querySelector<HTMLInputElement>('#claim-domain_email-email')
  expect(emailInput).not.toBeNull()
  fireEvent.change(emailInput!, { target: { value: 'not-an-email' } })

  expect(screen.getByRole('button', { name: /送出認領申請/ })).toBeDisabled()
})

it('always enables domain email proof regardless of whether the brand has a website', async () => {
  renderCta()
  fireEvent.click(await screen.findByText('認領這個品牌'))

  expect(screen.getByLabelText('品牌網域信箱')).toBeEnabled()
  expect(screen.queryByText('此品牌尚未登錄官網，無法使用 Email 驗證，請改用商業登記文件。')).not.toBeInTheDocument()

  fireEvent.click(screen.getByLabelText('品牌網域信箱'))
  const emailInput = document.querySelector<HTMLInputElement>('#claim-domain_email-email')
  expect(emailInput).not.toBeNull()

  fireEvent.change(emailInput!, { target: { value: 'owner@gmail.com' } })
  expect(screen.getByRole('button', { name: /送出認領申請/ })).toBeEnabled()
})

it('does not render the removed 備註 field or the MIT email line', async () => {
  renderCta()
  fireEvent.click(await screen.findByText('認領這個品牌'))
  expect(screen.queryByText('認領備註')).not.toBeInTheDocument()
  expect(screen.queryByText(/來信.*申請驗證/)).not.toBeInTheDocument()
})

it('submits the server-returned claim-proof image key after upload succeeds', async () => {
  renderCta()
  fireEvent.click(await screen.findByText('認領這個品牌'))
  fireEvent.click(screen.getByLabelText('後台截圖'))
  expect(screen.getByText(/Instagram／社群/)).toBeInTheDocument()

  const backendInput = document.querySelector<HTMLInputElement>('#claim-backend_screenshot-image')
  expect(backendInput).not.toBeNull()
  fireEvent.change(backendInput!, {
    target: { files: [new File(['image'], 'proof.png', { type: 'image/png' })] },
  })

  await waitFor(() => {
    expect(uploadMock).toHaveBeenCalled()
  })
  expect(mockUploadConfigs).toContainEqual(expect.objectContaining({
    bucket: 'claim-proofs',
    path: 'user-1/b1',
    acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    uploadFields: { proofType: 'backend_screenshot' },
  }))

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

it('renders business document upload with PDF support', async () => {
  renderCta()
  fireEvent.click(await screen.findByText('認領這個品牌'))
  fireEvent.click(screen.getByLabelText('商業登記文件'))

  const businessDocInput = document.querySelector<HTMLInputElement>('#claim-business_doc-image')
  expect(businessDocInput).not.toBeNull()
  expect(businessDocInput?.accept).toBe('application/pdf,image/*')
  expect(screen.getByText('PDF / JPG / PNG，最大 5MB')).toBeInTheDocument()
})
