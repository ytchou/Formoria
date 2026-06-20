import { describe, it, expect } from 'vitest'
import { buildWelcomeEmail } from '@emails/templates/welcome'
import { buildProfileNudgeEmail } from '@emails/templates/profile-nudge'
import { buildMicrositeSpotlightEmail } from '@emails/templates/microsite-spotlight'
import { buildReEngagementEmail } from '@emails/templates/re-engagement'

describe('buildWelcomeEmail', () => {
  it('returns branded welcome with unsubscribe', async () => {
    const email = await buildWelcomeEmail({
      to: 'owner@example.com',
      brandName: 'Test Brand',
      brandSlug: 'test-brand',
      unsubscribeToken: 'token123',
    })
    expect(email.to).toBe('owner@example.com')
    expect(email.from).toContain('noreply@formoria.com')
    expect(email.html).toContain('Test Brand')
    expect(email.html).toContain('Formoria')
    expect(email.html).toContain('Made in Taiwan')
    expect(email.html).toContain('取消訂閱')
    expect(email.html).toContain('token123')
    expect(email.headers?.['List-Unsubscribe']).toBeDefined()
    expect(email.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })
})

describe('buildProfileNudgeEmail', () => {
  it('returns branded nudge with completeness percentage', async () => {
    const email = await buildProfileNudgeEmail({
      to: 'owner@example.com',
      brandName: 'Test Brand',
      completenessPercent: 60,
      missingFields: ['description'],
      unsubscribeToken: 'token456',
    })
    expect(email.to).toBe('owner@example.com')
    expect(email.html).toContain('60')
    expect(email.html).toContain('Formoria')
    expect(email.headers?.['List-Unsubscribe']).toBeDefined()
  })
})

describe('buildMicrositeSpotlightEmail', () => {
  it('returns branded microsite spotlight', async () => {
    const email = await buildMicrositeSpotlightEmail({
      to: 'owner@example.com',
      brandName: 'Test Brand',
      brandSlug: 'test-brand',
      unsubscribeToken: 'token789',
    })
    expect(email.to).toBe('owner@example.com')
    expect(email.html).toContain('Formoria')
    expect(email.headers?.['List-Unsubscribe']).toBeDefined()
  })
})

describe('buildReEngagementEmail', () => {
  it('returns branded re-engagement', async () => {
    const email = await buildReEngagementEmail({
      to: 'owner@example.com',
      brandName: 'Test Brand',
      brandSlug: 'test-brand',
      unsubscribeToken: 'tokenABC',
    })
    expect(email.to).toBe('owner@example.com')
    expect(email.html).toContain('Formoria')
    expect(email.headers?.['List-Unsubscribe']).toBeDefined()
  })
})
