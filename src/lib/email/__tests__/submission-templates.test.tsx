import { describe, it, expect } from 'vitest'
import { buildApprovalEmail } from '@emails/templates/submission-approved'
import { buildRejectionEmail } from '@emails/templates/submission-rejected'

describe('buildApprovalEmail', () => {
  it('returns EmailMessage with branded HTML', async () => {
    const email = await buildApprovalEmail({
      submitterEmail: 'test@example.com',
      brandName: 'Test Brand',
      brandSlug: 'test-brand',
      siteUrl: 'https://formoria.com',
    })
    expect(email.to).toBe('test@example.com')
    expect(email.from).toContain('noreply@formoria.com')
    expect(email.subject).toContain('Test Brand')
    expect(email.html).toContain('Test Brand')
    expect(email.html).toContain('test-brand')
    expect(email.html).toContain('Formoria')
    expect(email.html).toContain('Made in Taiwan')
    expect(email.html).toContain('#FAF8F3')
    expect(email.html).not.toContain('<script>')
    expect(email.html).not.toContain('undefined')
  })

  it('renders bilingual content for zh-TW locale', async () => {
    const email = await buildApprovalEmail({
      submitterEmail: 'test@example.com',
      brandName: 'Test Brand',
      brandSlug: 'test-brand',
      siteUrl: 'https://formoria.com',
      locale: 'zh-TW',
    })
    expect(email.html).toContain('已通過審核')
  })
})

describe('buildRejectionEmail', () => {
  it('returns EmailMessage with reviewer notes', async () => {
    const email = await buildRejectionEmail({
      submitterEmail: 'test@example.com',
      brandName: 'Test Brand',
      reviewerNotes: 'Not a Taiwan brand',
    })
    expect(email.to).toBe('test@example.com')
    expect(email.subject).toContain('Test Brand')
    expect(email.html).toContain('Not a Taiwan brand')
    expect(email.html).toContain('Formoria')
    expect(email.html).not.toContain('<script>')
  })
})
