import { describe, it, expect } from 'vitest'
import {
  buildApprovalEmail,
  buildRejectionEmail,
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
    expect(email.subject).toContain('approved')
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
    expect(email.html).toContain('Description')
    expect(email.html).toContain('Website')
  })
})
