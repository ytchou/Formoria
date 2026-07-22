import { describe, expect, it } from 'vitest'
import { buildDeclarationRemovedEmail } from '@/lib/email/templates'

describe('buildDeclarationRemovedEmail', () => {
  it('returns a declaration-removed notification with reviewer notes', async () => {
    const ownerEmail = 'owner@example.com'
    const brandName = 'Test Brand'
    const reviewerNotes = 'Community evidence contradicted the declaration'

    const email = await buildDeclarationRemovedEmail({
      ownerEmail,
      brandName,
      reviewerNotes,
      locale: 'zh-TW',
    })

    expect(email.to).toBe(ownerEmail)
    expect(email.subject).toContain(brandName)
    expect(email.html).toContain(reviewerNotes)
  })
})
