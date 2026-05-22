import { describe, it, expect } from 'vitest'
import {
  buildApprovalEmail,
  buildRejectionEmail,
  buildClaimEmail,
  buildIncompleteSubmissionEmail,
} from './templates'

describe('buildApprovalEmail', () => {
  it('builds an approval email with correct fields', () => {
    const email = buildApprovalEmail({
      submitterEmail: 'owner@brand.com',
      brandName: 'Test Brand',
      brandSlug: 'test-brand',
      siteUrl: 'https://mitmap.tw',
    })
    expect(email.to).toBe('owner@brand.com')
    expect(email.subject).toContain('Test Brand')
    expect(email.subject).toContain('已通過審核')
    expect(email.html).toContain('Test Brand')
    expect(email.html).toContain('https://mitmap.tw/brands/test-brand')
    expect(email.from).toContain('mitmap')
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
      claimUrl: 'https://mitmap.tw/auth/sign-up?claim=abc123',
      siteUrl: 'https://mitmap.tw',
    })

    expect(result.to).toBe('owner@example.com')
    expect(result.subject).toContain('認領您在 MIT Map')
    expect(result.html).toContain('Dachun Soap')
    expect(result.html).toContain('https://mitmap.tw/auth/sign-up?claim=abc123')
    expect(result.html).toContain('認領')
  })

  it('escapes HTML in brand name', () => {
    const result = buildClaimEmail({
      submitterEmail: 'owner@example.com',
      brandName: '<script>alert("xss")</script>',
      claimUrl: 'https://mitmap.tw/auth/sign-up?claim=abc123',
      siteUrl: 'https://mitmap.tw',
    })

    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('&lt;script&gt;')
  })
})

describe('buildIncompleteSubmissionEmail', () => {
  it('lists missing fields in the email body', () => {
    const email = buildIncompleteSubmissionEmail({
      submitterEmail: 'owner@brand.com',
      brandName: 'Test Brand',
      missingFields: ['description_too_short', 'website_url_invalid'],
      siteUrl: 'https://mitmap.tw',
    })
    expect(email.to).toBe('owner@brand.com')
    expect(email.subject).toContain('Test Brand')
    expect(email.html).toContain('品牌介紹')
    expect(email.html).toContain('網站')
  })
})
