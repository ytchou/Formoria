import { describe, it, expect } from 'vitest'
import { buildMitVerificationSubmittedEmail } from '@emails/templates/mit-verification-submitted'
import { buildMitVerificationApprovedEmail } from '@emails/templates/mit-verification-approved'
import { buildMitVerificationNeedsDocsEmail } from '@emails/templates/mit-verification-needs-docs'

describe('buildMitVerificationSubmittedEmail', () => {
  it('returns branded MIT submission confirmation', async () => {
    const email = await buildMitVerificationSubmittedEmail({ to: 'owner@example.com', brandName: 'Test Brand' })
    expect(email.to).toBe('owner@example.com')
    expect(email.from).toContain('noreply@formoria.com')
    expect(email.replyTo).toBe('ops@formoria.com')
    expect(email.html).toContain('Test Brand')
    expect(email.html).toContain('Formoria')
  })
})

describe('buildMitVerificationApprovedEmail', () => {
  it('returns branded MIT approval', async () => {
    const email = await buildMitVerificationApprovedEmail({ to: 'owner@example.com', brandName: 'Test Brand' })
    expect(email.to).toBe('owner@example.com')
    expect(email.replyTo).toBe('ops@formoria.com')
    expect(email.html).toContain('Formoria')
  })
})

describe('buildMitVerificationNeedsDocsEmail', () => {
  it('returns branded needs-docs with reviewer notes', async () => {
    const email = await buildMitVerificationNeedsDocsEmail({
      to: 'owner@example.com',
      brandName: 'Test Brand',
      notes: 'Please provide certificate of origin',
    })
    expect(email.to).toBe('owner@example.com')
    expect(email.replyTo).toBe('ops@formoria.com')
    expect(email.html).toContain('certificate of origin')
    expect(email.html).toContain('Formoria')
    expect(email.html).not.toContain('<script>')
  })
})
