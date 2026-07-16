import { describe, expect, it } from 'vitest'
import { buildOwnershipRevokedEmail } from '@/lib/email/templates'

describe('buildOwnershipRevokedEmail', () => {
  it('returns a bilingual ownership-revoked notification with the reason', async () => {
    const ownerEmail = 'owner@example.com'
    const brandName = 'Test Brand'
    const reason = 'Ownership could not be verified'

    const email = await buildOwnershipRevokedEmail({
      ownerEmail,
      brandName,
      reason,
    })

    expect(email.to).toBe(ownerEmail)
    expect(email.subject).toContain(brandName)
    expect(email.html).toContain(brandName)
    expect(email.html).toContain(reason)
    expect(email.html).toContain('品牌管理權限已移除')
    expect(email.html).toContain('Brand management access removed')
  })
})
