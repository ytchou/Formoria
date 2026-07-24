import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClaimUser: vi.fn(),
  revalidatePath: vi.fn(),
  getTranslations: vi.fn(),
  confirmChannel: vi.fn(),
  getChannelsForBrand: vi.fn(),
  submitChannel: vi.fn(),
  setOwnerChannelStatus: vi.fn(),
  isOwnerOf: vi.fn(),
  createClaimRequest: vi.fn(),
  hasPendingClaim: vi.fn(),
  createEvidence: vi.fn(),
  createReport: vi.fn(),
  enrollInMarketingEmails: vi.fn(),
  createServiceClient: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}))

vi.mock('next-intl/server', () => ({
  getTranslations: mocks.getTranslations,
}))

vi.mock('@/lib/auth/claim-user', () => ({
  requireClaimUser: mocks.requireClaimUser,
}))

vi.mock('@/lib/auth/site-url', () => ({
  getSiteUrl: vi.fn(() => 'https://formoria.com'),
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/email/templates', () => ({
  buildClaimEmailVerificationEmail: vi.fn(),
}))

vi.mock('@/lib/security/rate-limiter', () => ({
  createInMemoryRateLimiter: vi.fn(() => ({
    check: vi.fn(() => ({ allowed: true })),
  })),
}))

vi.mock('@/lib/services/brands', () => ({
  getBrandById: vi.fn(),
}))

vi.mock('@/lib/services/claim-requests', () => ({
  CLAIM_PROOF_TYPES: ['domain_email', 'backend_screenshot', 'business_doc'],
  createClaimRequest: mocks.createClaimRequest,
  hasPendingClaim: mocks.hasPendingClaim,
}))

vi.mock('@/lib/services/reports', () => ({
  createReport: mocks.createReport,
}))

vi.mock('@/lib/services/origin-evidence', () => ({
  createEvidence: mocks.createEvidence,
}))

vi.mock('@/lib/services/marketing-email-consent', () => ({
  enrollInMarketingEmails: mocks.enrollInMarketingEmails,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mocks.createServiceClient,
}))

vi.mock('@/lib/analytics', () => ({
  trackOriginEvidenceSubmitted: vi.fn(),
}))

vi.mock('@/lib/services/brand-channels', () => ({
  confirmChannel: mocks.confirmChannel,
  getChannelsForBrand: mocks.getChannelsForBrand,
  submitChannel: mocks.submitChannel,
  setOwnerChannelStatus: mocks.setOwnerChannelStatus,
}))

vi.mock('@/lib/services/brand-owners', () => ({
  isOwnerOf: mocks.isOwnerOf,
}))

const {
  confirmChannelAction,
  ownerModerateChannelAction,
  submitChannelInfoAction,
} = await import('../actions')

function makeFormData(data: Record<string, string>): FormData {
  const formData = new FormData()
  Object.entries(data).forEach(([key, value]) => formData.set(key, value))
  return formData
}

function channelFormData(overrides: Record<string, string> = {}): FormData {
  return makeFormData({
    name: 'Example Store',
    channelType: 'offline',
    category: 'Retail',
    region: 'Taipei',
    address: '1 Example Road',
    url: 'https://example.com/stores',
    brandId: 'brand-1',
    brandSlug: 'example-brand',
    ...overrides,
  })
}

describe('brand channel actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireClaimUser.mockResolvedValue({ id: 'user-1', email: 'user@example.com' })
    mocks.getTranslations.mockImplementation(async () => (key: string) => `channels.errors.${key}`)
    mocks.confirmChannel.mockResolvedValue(3)
    mocks.submitChannel.mockResolvedValue({ ok: true, id: 'channel-1' })
    mocks.setOwnerChannelStatus.mockResolvedValue({ ok: true })
    mocks.getChannelsForBrand.mockResolvedValue({ confirmed: [], possible: [] })
    mocks.isOwnerOf.mockResolvedValue(false)
  })

  it('rejects anonymous channel confirmation without calling the service', async () => {
    mocks.requireClaimUser.mockResolvedValueOnce(null)

    await expect(confirmChannelAction('channel-1', 'example-brand')).resolves.toEqual({
      error: 'not_logged_in',
    })
    expect(mocks.confirmChannel).not.toHaveBeenCalled()
  })

  it('revalidates both locale paths after confirming a channel', async () => {
    mocks.confirmChannel.mockResolvedValueOnce(4)

    await expect(confirmChannelAction('channel-1', 'example-brand')).resolves.toEqual({
      confirmationCount: 4,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/brands/example-brand')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/en/brands/example-brand')
  })

  it('validates form data and maps cap and collision errors to distinct i18n messages', async () => {
    await expect(
      submitChannelInfoAction(
        {},
        channelFormData({ brandId: '' }),
      ),
    ).resolves.toEqual({ error: 'channels.errors.missing_brand_id' })
    expect(mocks.submitChannel).not.toHaveBeenCalled()

    mocks.submitChannel.mockResolvedValueOnce({ ok: false, code: 'active_cap_reached' })
    await expect(submitChannelInfoAction({}, channelFormData())).resolves.toEqual({
      error: 'channels.errors.active_cap_reached',
    })

    mocks.submitChannel.mockResolvedValueOnce({ ok: false, code: 'duplicate_name' })
    await expect(submitChannelInfoAction({}, channelFormData())).resolves.toEqual({
      error: 'channels.errors.duplicate_name',
    })
    expect(mocks.submitChannel).toHaveBeenLastCalledWith(
      'user-1',
      'brand-1',
      {
        name: 'Example Store',
        channelType: 'offline',
        category: 'Retail',
        region: 'Taipei',
        address: '1 Example Road',
        url: 'https://example.com/stores',
      },
    )
    expect(mocks.getTranslations).toHaveBeenCalledWith('brandDetail.channels.errors')
  })

  it('passes through an ownership rejection from owner moderation', async () => {
    mocks.setOwnerChannelStatus.mockResolvedValueOnce({ ok: false, code: 'not_owner' })

    await expect(
      ownerModerateChannelAction('channel-1', 'example-brand', 'confirmed'),
    ).resolves.toEqual({ error: 'not_owner' })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
