import { describe, expect, it } from 'vitest'
import { buildDeclarationRemovedEmail } from '@/lib/email/templates'

describe('buildDeclarationRemovedEmail', () => {
  it('returns a declaration-removed notification with reviewer notes', async () => {
    const ownerEmail = 'owner@example.com'
    const brandName = 'Test Brand'
    const brandSlug = 'test-brand'
    const reviewerNotes = 'Community evidence contradicted the declaration'

    const email = await buildDeclarationRemovedEmail({
      ownerEmail,
      brandName,
      brandSlug,
      reviewerNotes,
      locale: 'zh-TW',
    })

    expect(email.to).toBe(ownerEmail)
    expect(email.subject).toContain(brandName)
    expect(email.html).toContain(reviewerNotes)
    // DEV-1570 removed the owner dashboard; the CTA must point at the brand's
    // public page, which still exists.
    expect(email.html).toContain('/brands/test-brand')
    expect(email.html).not.toContain('/dashboard')
  })
})
