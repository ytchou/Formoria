import { describe, it, expect } from 'vitest'
import { buildViolationAdminNotificationEmail } from '@/lib/email/templates'

describe('buildViolationAdminNotificationEmail', () => {
  it('builds email with brand name and violations', async () => {
    const email = await buildViolationAdminNotificationEmail({
      brandName: 'Test Brand',
      ownerEmail: 'owner@example.com',
      violations: [
        { field: 'website', rule: 'suspicious_tld', userMessage: 'Suspicious URL (.tk)' },
        { field: 'description', rule: 'contact_injection_phone', userMessage: 'Contains phone number' },
      ],
    })

    expect(email.subject).toContain('Test Brand')
    expect(email.html).toContain('Test Brand')
    expect(email.html).toContain('owner@example.com')
    expect(email.html).toContain('website')
    expect(email.html).toContain('suspicious_tld')
  })

  it('uses default admin email when not provided', async () => {
    const email = await buildViolationAdminNotificationEmail({
      brandName: 'Brand',
      ownerEmail: 'owner@test.com',
      violations: [{ field: 'name', rule: 'english_spam', userMessage: 'Spam detected' }],
    })

    expect(email.to).toBeDefined()
    expect(email.from).toBeDefined()
  })
})
