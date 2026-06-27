import { describe, it, expect } from 'vitest'
import { buildWelcomeEmail } from '@emails/templates/welcome'
import { buildProfileNudgeEmail } from '@emails/templates/profile-nudge'
import { buildMicrositeSpotlightEmail } from '@emails/templates/microsite-spotlight'
import { buildReEngagementEmail } from '@emails/templates/re-engagement'

type DripEmailParams = {
  to: string
  brandName: string
  locale: 'zh-TW' | 'en'
}

const DRIP_TEMPLATES = [
  {
    name: 'welcome',
    builder: (params: DripEmailParams) =>
      buildWelcomeEmail({
        ...params,
        brandSlug: 'test-brand',
        unsubscribeToken: 'token123',
      }),
    zhSubject: '歡迎加入',
    enSubject: 'Welcome to',
  },
  {
    name: 'profile-nudge',
    builder: (params: DripEmailParams) =>
      buildProfileNudgeEmail({
        ...params,
        completenessPercent: 60,
        missingFields: ['description'],
        unsubscribeToken: 'token456',
      }),
    zhSubject: '完善',
    enSubject: 'Complete',
  },
  {
    name: 'microsite-spotlight',
    builder: (params: DripEmailParams) =>
      buildMicrositeSpotlightEmail({
        ...params,
        brandSlug: 'test-brand',
        unsubscribeToken: 'token789',
      }),
    zhSubject: '品牌頁已就緒',
    enSubject: 'brand page is ready',
  },
  {
    name: 're-engagement',
    builder: (params: DripEmailParams) =>
      buildReEngagementEmail({
        ...params,
        brandSlug: 'test-brand',
        unsubscribeToken: 'tokenABC',
      }),
    zhSubject: '回來完善',
    enSubject: 'Come back',
  },
]

describe.each(DRIP_TEMPLATES)('$name drip email', ({ builder, zhSubject, enSubject }) => {
  it('renders Chinese for zh-TW locale', async () => {
    const email = await builder({
      to: 'test@example.com',
      brandName: '測試品牌',
      locale: 'zh-TW',
    })

    expect(email.subject).toContain(zhSubject)
    expect(email.subject).toContain('— Formoria')
  })

  it('renders English for en locale', async () => {
    const email = await builder({
      to: 'test@example.com',
      brandName: 'TestBrand',
      locale: 'en',
    })

    expect(email.subject).toContain(enSubject)
    expect(email.subject).toContain('— Formoria')
    expect(email.html).not.toContain('歡迎')
  })
})

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
