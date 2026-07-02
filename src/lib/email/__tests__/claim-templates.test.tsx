import { describe, it, expect } from 'vitest'
import { buildClaimEmail } from '@emails/templates/claim-submitted'
import { buildClaimEmailVerificationEmail } from '@emails/templates/claim-verified'
import { buildClaimApprovedEmail } from '@emails/templates/claim-approved'
import { buildClaimRejectedEmail } from '@emails/templates/claim-rejected'

describe('buildClaimEmail', () => {
  it('returns branded claim notification', async () => {
    const email = await buildClaimEmail({
      submitterEmail: 'owner@example.com',
      brandName: 'Test Brand',
      claimUrl: 'https://formoria.com/claim/123',
      siteUrl: 'https://formoria.com',
    })
    expect(email.to).toBe('owner@example.com')
    expect(email.from).toContain('noreply@formoria.com')
    expect(email.html).toContain('Test Brand')
    expect(email.html).toContain('claim/123')
    expect(email.html).toContain('Formoria')
    expect(email.html).toContain('Made in Taiwan')
    expect(email.html).not.toContain('<script>')
  })
})

describe('buildClaimEmailVerificationEmail', () => {
  it('returns branded verification email', async () => {
    const email = await buildClaimEmailVerificationEmail({
      recipientEmail: 'owner@example.com',
      brandName: 'Test Brand',
      verifyUrl: 'https://formoria.com/verify/abc',
      siteUrl: 'https://formoria.com',
    })
    expect(email.to).toBe('owner@example.com')
    expect(email.html).toContain('verify/abc')
    expect(email.html).toContain('Formoria')
  })
})

describe('buildClaimApprovedEmail', () => {
  it('returns branded approval with dashboard link', async () => {
    const email = await buildClaimApprovedEmail({
      ownerEmail: 'owner@example.com',
      brandName: 'Test Brand',
      brandSlug: 'test-brand',
      siteUrl: 'https://formoria.com',
    })
    expect(email.to).toBe('owner@example.com')
    expect(email.html).toContain('test-brand')
    expect(email.html).toContain('Formoria')
  })

  it('includes the share-card image, download CTA, and badge deep link (zh-TW)', async () => {
    const email = await buildClaimApprovedEmail({
      ownerEmail: 'owner@example.com',
      brandName: '鮮乳坊',
      brandSlug: 'yu-cha-ye',
      siteUrl: 'https://formoria.com',
    })
    const html = email.html
    expect(html).toContain('https://formoria.com/api/share-card/yu-cha-ye')
    expect(html).toContain('https://formoria.com/api/share-card/yu-cha-ye?download=1')
    expect(html).toContain('https://formoria.com/dashboard?brand=yu-cha-ye#badge')
    expect(html).not.toContain('?tab=')
  })

  it('escapes the brand name in the new copy', async () => {
    const email = await buildClaimApprovedEmail({
      ownerEmail: 'owner@example.com',
      brandName: '<script>alert(1)</script>',
      brandSlug: 'xss-brand',
      siteUrl: 'https://formoria.com',
    })
    expect(email.html).not.toContain('<script>alert(1)</script>')
  })

  it('includes the share-card image, download CTA, and badge deep link (en)', async () => {
    const email = await buildClaimApprovedEmail({
      ownerEmail: 'owner@example.com',
      brandName: 'Test Brand',
      brandSlug: 'yu-cha-ye',
      siteUrl: 'https://formoria.com',
      locale: 'en',
    })
    const html = email.html
    expect(html).toContain('https://formoria.com/api/share-card/yu-cha-ye')
    expect(html).toContain('https://formoria.com/api/share-card/yu-cha-ye?download=1')
    expect(html).toContain('https://formoria.com/dashboard?brand=yu-cha-ye#badge')
    expect(html).not.toContain('?tab=')
  })
})

describe('buildClaimRejectedEmail', () => {
  it('returns branded rejection with notes', async () => {
    const email = await buildClaimRejectedEmail({
      ownerEmail: 'owner@example.com',
      brandName: 'Test Brand',
      reviewerNotes: 'Insufficient proof',
    })
    expect(email.to).toBe('owner@example.com')
    expect(email.html).toContain('Insufficient proof')
    expect(email.html).toContain('Formoria')
    expect(email.html).not.toContain('<script>')
  })
})
