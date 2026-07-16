import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/services/newsletter', () => ({
  createSubscriber: vi.fn(),
}))

vi.mock('@/lib/services/email-lifecycle', () => ({
  setLifecycleEmailPreference: vi.fn(),
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@emails/templates/newsletter-confirm', () => ({
  buildNewsletterConfirmEmail: vi.fn().mockResolvedValue({
    to: 'owner@example.com',
    from: 'Formoria <noreply@formoria.com>',
    subject: 'Confirm',
    html: '<p>Confirm</p>',
  }),
}))

import { sendEmail } from '@/lib/email/send'
import { setLifecycleEmailPreference } from '@/lib/services/email-lifecycle'
import { createSubscriber } from '@/lib/services/newsletter'
import {
  enrollInMarketingEmails,
  MARKETING_CONSENT_VERSION,
} from '../marketing-email-consent'

describe('marketing email consent orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createSubscriber).mockResolvedValue({
      subscriber: {
        id: 'subscriber-1',
        email: 'owner@example.com',
        name: null,
        interests: ['curated-picks'],
        locale: 'zh-TW',
        subscribed_at: '2026-07-16T00:00:00Z',
        confirmed_at: null,
        confirm_token: 'confirm-token',
        unsubscribe_token: 'unsubscribe-token',
        unsubscribed_at: null,
        consent_source: 'account_signup',
        consent_version: MARKETING_CONSENT_VERSION,
        consent_recorded_at: '2026-07-16T00:00:00Z',
        created_at: '2026-07-16T00:00:00Z',
      },
      isNew: true,
      needsConfirmation: true,
    })
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'msg-1' })
    vi.mocked(setLifecycleEmailPreference).mockResolvedValue()
  })

  it('records newsletter and lifecycle consent with server-owned provenance', async () => {
    const result = await enrollInMarketingEmails({} as never, {
      email: 'owner@example.com',
      userId: 'user-1',
      locale: 'zh-TW',
      source: 'account_signup',
      newsletter: true,
      lifecycle: true,
    })

    expect(createSubscriber).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        consentSource: 'account_signup',
        consentVersion: MARKETING_CONSENT_VERSION,
      }),
    )
    expect(setLifecycleEmailPreference).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        enabled: true,
        consentSource: 'account_signup',
        consentVersion: MARKETING_CONSENT_VERSION,
      }),
    )
    expect(result.newsletter).toBe('pending')
    expect(result.lifecycle).toBe('on')
  })

  it('does not reject the primary flow when confirmation delivery fails', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'provider down' })

    await expect(
      enrollInMarketingEmails({} as never, {
        email: 'owner@example.com',
        locale: 'en',
        source: 'guest_recommendation',
        newsletter: true,
        lifecycle: false,
      }),
    ).resolves.toEqual({ newsletter: 'failed', lifecycle: 'not_requested' })
  })
})
