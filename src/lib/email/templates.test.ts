import { describe, it, expect } from 'vitest'
import {
  buildApprovalEmail,
  buildRejectionEmail,
  buildClaimEmail,
  buildClaimEmailVerificationEmail,
  buildClaimApprovedEmail,
  buildClaimRejectedEmail,
  buildIncompleteSubmissionEmail,
  buildMitVerificationSubmittedEmail,
  buildMitVerificationApprovedEmail,
  buildMitVerificationNeedsDocsEmail,
  buildWelcomeEmail,
  buildProfileNudgeEmail,
  buildMicrositeSpotlightEmail,
  buildReEngagementEmail,
} from './templates'

describe('buildApprovalEmail', () => {
  it('builds an approval email with correct fields', () => {
    const email = buildApprovalEmail({
      submitterEmail: 'owner@brand.com',
      brandName: 'Test Brand',
      brandSlug: 'test-brand',
      siteUrl: 'https://formoria.com',
    })
    expect(email.to).toBe('owner@brand.com')
    expect(email.subject).toContain('Test Brand')
    expect(email.subject).toContain('已通過審核')
    expect(email.subject).toContain('Formoria')
    expect(email.subject).not.toContain('MIT Map')
    expect(email.html).toContain('Test Brand')
    expect(email.html).toContain('https://formoria.com/brands/test-brand')
    expect(email.html).toContain('Formoria — 台灣品牌目錄')
    expect(email.from).toBe('Formoria <noreply@formoria.com>')
  })
})

describe('buildRejectionEmail', () => {
  it('builds a rejection email with reviewer notes', () => {
    const email = buildRejectionEmail({
      submitterEmail: 'owner@brand.com',
      brandName: 'Test Brand',
      reviewerNotes: 'Missing product photos',
    })
    expect(email.to).toBe('owner@brand.com')
    expect(email.subject).toContain('Test Brand')
    expect(email.html).toContain('Missing product photos')
  })

  it('handles null reviewer notes gracefully', () => {
    const email = buildRejectionEmail({
      submitterEmail: 'owner@brand.com',
      brandName: 'Test Brand',
      reviewerNotes: null,
    })
    expect(email.to).toBe('owner@brand.com')
    expect(email.html).not.toContain('null')
  })
})

describe('buildClaimEmail', () => {
  it('returns an EmailMessage with claim URL in body', () => {
    const result = buildClaimEmail({
      submitterEmail: 'owner@example.com',
      brandName: 'Dachun Soap',
      claimUrl: 'https://formoria.com/auth/sign-up?claim=abc123',
      siteUrl: 'https://formoria.com',
    })

    expect(result.to).toBe('owner@example.com')
    expect(result.subject).toContain('認領您在 Formoria')
    expect(result.html).toContain('Dachun Soap')
    expect(result.html).toContain('https://formoria.com/auth/sign-up?claim=abc123')
    expect(result.html).toContain('認領')
  })

  it('escapes HTML in brand name', () => {
    const result = buildClaimEmail({
      submitterEmail: 'owner@example.com',
      brandName: '<script>alert("xss")</script>',
      claimUrl: 'https://formoria.com/auth/sign-up?claim=abc123',
      siteUrl: 'https://formoria.com',
    })

    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('&lt;script&gt;')
  })
})

describe('buildClaimEmailVerificationEmail', () => {
  it('builds localized verification email fields', () => {
    const result = buildClaimEmailVerificationEmail({
      recipientEmail: 'owner@brand.com',
      brandName: 'Test Brand',
      verifyUrl: 'https://formoria.com/api/claim/verify-email?token=abc',
      siteUrl: 'https://formoria.com',
      locale: 'en',
    })

    expect(result.to).toBe('owner@brand.com')
    expect(result.from).toBe('Formoria <noreply@formoria.com>')
    expect(result.subject).toBe('Verify your claim email — Formoria')
    expect(result.html).toContain('Test Brand')
    expect(result.html).toContain('https://formoria.com/api/claim/verify-email?token=abc')
    expect(result.html).toContain('expires in 7 days')
  })

  it('escapes HTML in verification email interpolations', () => {
    const result = buildClaimEmailVerificationEmail({
      recipientEmail: 'owner@brand.com',
      brandName: '<script>alert("xss")</script>',
      verifyUrl: 'https://formoria.com/api/claim/verify-email?token=<bad>',
      siteUrl: 'https://formoria.com',
    })

    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('&lt;script&gt;')
    expect(result.html).toContain('token=&lt;bad&gt;')
  })
})

describe('buildIncompleteSubmissionEmail', () => {
  it('lists missing fields in the email body', () => {
    const email = buildIncompleteSubmissionEmail({
      submitterEmail: 'owner@brand.com',
      brandName: 'Test Brand',
      missingFields: ['description_too_short', 'website_url_invalid'],
      siteUrl: 'https://formoria.com',
    })
    expect(email.to).toBe('owner@brand.com')
    expect(email.subject).toContain('Test Brand')
    expect(email.html).toContain('品牌介紹')
    expect(email.html).toContain('網站')
  })
})

describe('buildClaimApprovedEmail', () => {
  const msg = buildClaimApprovedEmail({
    ownerEmail: 'owner@example.com',
    brandName: '島嶼工坊',
    brandSlug: 'island-workshop',
    siteUrl: 'https://formoria.com',
  })

  it('addresses the owner from the Formoria no-reply address', () => {
    expect(msg.to).toBe('owner@example.com')
    expect(msg.from).toContain('noreply@formoria.com')
  })

  it('has a non-empty subject mentioning the brand', () => {
    expect(msg.subject.length).toBeGreaterThan(0)
    expect(msg.subject).toContain('島嶼工坊')
  })

  it('is bilingual and links to the owner dashboard', () => {
    expect(msg.html).toContain('島嶼工坊')
    expect(msg.html).toMatch(/[一-鿿]/)
    expect(msg.html).toMatch(/[A-Za-z]{3,}/)
    expect(msg.html).toContain(
      'https://formoria.com/dashboard?tab=island-workshop'
    )
  })
})

describe('buildClaimRejectedEmail', () => {
  it('includes reviewer notes when present', () => {
    const msg = buildClaimRejectedEmail({
      ownerEmail: 'owner@example.com',
      brandName: '島嶼工坊',
      reviewerNotes: '無法驗證網域擁有權 / could not verify domain ownership',
      siteUrl: 'https://formoria.com',
    })
    expect(msg.to).toBe('owner@example.com')
    expect(msg.from).toContain('noreply@formoria.com')
    expect(msg.html).toContain('could not verify domain ownership')
  })

  it('omits the notes block cleanly when notes are empty', () => {
    const msg = buildClaimRejectedEmail({
      ownerEmail: 'owner@example.com',
      brandName: '島嶼工坊',
      reviewerNotes: '',
      siteUrl: 'https://formoria.com',
    })
    expect(msg.html).toContain('島嶼工坊')
    expect(msg.html).not.toMatch(/undefined|null/)
  })
})

describe('buildMitVerificationSubmittedEmail', () => {
  it('includes brand name and bilingual content', () => {
    const email = buildMitVerificationSubmittedEmail({ to: 'owner@example.com', brandName: 'Tea Co' })
    expect(email.to).toBe('owner@example.com')
    expect(email.subject).toContain('MIT')
    expect(email.html).toContain('Tea Co')
    expect(email.html).toContain('已收到')
    expect(email.html).toContain('received')
    expect(email.replyTo).toBe('ops@formoria.com')
  })
})

describe('buildMitVerificationApprovedEmail', () => {
  it('includes brand name and verified badge mention', () => {
    const email = buildMitVerificationApprovedEmail({ to: 'owner@example.com', brandName: 'Tea Co' })
    expect(email.to).toBe('owner@example.com')
    expect(email.html).toContain('Tea Co')
    expect(email.html).toContain('已驗證')
    expect(email.html).toContain('verified')
    expect(email.replyTo).toBe('ops@formoria.com')
  })
})

describe('buildMitVerificationNeedsDocsEmail', () => {
  it('includes brand name and admin notes', () => {
    const email = buildMitVerificationNeedsDocsEmail({ to: 'owner@example.com', brandName: 'Tea Co', notes: 'Please provide company registration certificate' })
    expect(email.to).toBe('owner@example.com')
    expect(email.html).toContain('Tea Co')
    expect(email.html).toContain('company registration certificate')
    expect(email.html).toContain('補充文件')
    expect(email.replyTo).toBe('ops@formoria.com')
  })
})

describe('buildWelcomeEmail', () => {
  it('includes brand name, dashboard link, and microsite link', () => {
    const email = buildWelcomeEmail({ to: 'owner@example.com', brandName: 'Tea Co', brandSlug: 'tea-co', unsubscribeToken: 'token-abc' })
    expect(email.to).toBe('owner@example.com')
    expect(email.html).toContain('Tea Co')
    expect(email.html).toContain('/dashboard')
    expect(email.html).toContain('tea-co')
    expect(email.html).toContain('歡迎')
    expect(email.html).toContain('unsubscribe')
    expect(email.html).toContain('token-abc')
    expect(email.headers?.['List-Unsubscribe']).toBeDefined()
  })
})

describe('buildProfileNudgeEmail', () => {
  it('includes completeness percentage and missing fields', () => {
    const email = buildProfileNudgeEmail({ to: 'owner@example.com', brandName: 'Tea Co', completenessPercent: 50, missingFields: ['story', 'website'], unsubscribeToken: 'token-abc' })
    expect(email.html).toContain('Tea Co')
    expect(email.html).toContain('50%')
    expect(email.html).toContain('story')
    expect(email.html).toContain('unsubscribe')
    expect(email.headers?.['List-Unsubscribe']).toBeDefined()
  })
})

describe('buildMicrositeSpotlightEmail', () => {
  it('includes microsite URL', () => {
    const email = buildMicrositeSpotlightEmail({ to: 'owner@example.com', brandName: 'Tea Co', brandSlug: 'tea-co', unsubscribeToken: 'token-abc' })
    expect(email.html).toContain('Tea Co')
    expect(email.html).toContain('tea-co')
    expect(email.html).toContain('官網')
    expect(email.html).toContain('unsubscribe')
    expect(email.headers?.['List-Unsubscribe']).toBeDefined()
  })
})

describe('buildReEngagementEmail', () => {
  it('includes brand name and encouragement to complete profile', () => {
    const email = buildReEngagementEmail({ to: 'owner@example.com', brandName: 'Tea Co', brandSlug: 'tea-co', unsubscribeToken: 'token-abc' })
    expect(email.html).toContain('Tea Co')
    expect(email.html).toContain('完善')
    expect(email.html).toContain('unsubscribe')
    expect(email.headers?.['List-Unsubscribe']).toBeDefined()
  })
})
