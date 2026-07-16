import { describe, expect, it } from 'vitest'
import { buildClaimApprovedEmail } from '@emails/templates/claim-approved'
import { buildClaimRejectedEmail } from '@emails/templates/claim-rejected'
import { buildClaimEmail } from '@emails/templates/claim-submitted'
import { buildClaimEmailVerificationEmail } from '@emails/templates/claim-verified'
import { buildEditApprovedEmail } from '@emails/templates/edit-approved'
import { buildEditRejectedEmail } from '@emails/templates/edit-rejected'
import { buildMicrositeSpotlightEmail } from '@emails/templates/microsite-spotlight'
import { buildNewsletterConfirmEmail } from '@emails/templates/newsletter-confirm'
import { buildOwnershipRevokedEmail } from '@emails/templates/ownership-revoked'
import { buildProfileNudgeEmail } from '@emails/templates/profile-nudge'
import { buildReEngagementEmail } from '@emails/templates/re-engagement'
import { buildApprovalEmail } from '@emails/templates/submission-approved'
import { buildRejectionEmail } from '@emails/templates/submission-rejected'
import { buildWelcomeEmail } from '@emails/templates/welcome'
import type { EmailMessage } from '@emails/types'

type Locale = 'zh-TW' | 'en'

type SubjectCase = {
  name: string
  locale: Locale
  build: () => Promise<EmailMessage>
  expected?: string
  includesBrandName?: boolean
  allowsPrefixException?: boolean
}

const SITE_URL = 'https://formoria.com'
const EMAIL = 'owner@example.com'
const EN_BRAND = 'Test Brand'
const ZH_BRAND = '測試品牌'

const claimSubmitted = (locale: Locale, brandName: string) =>
  buildClaimEmail({
    submitterEmail: EMAIL,
    brandName,
    claimUrl: `${SITE_URL}/claim/123`,
    siteUrl: SITE_URL,
    locale,
  })

const approval = (locale: Locale, brandName: string) =>
  buildApprovalEmail({
    submitterEmail: EMAIL,
    brandName,
    brandSlug: 'test-brand',
    siteUrl: SITE_URL,
    locale,
  })

const rejection = (locale: Locale, brandName: string) =>
  buildRejectionEmail({
    submitterEmail: EMAIL,
    brandName,
    denialReason: 'not_mit',
    reviewerNotes: null,
    locale,
  })

const claimVerification = (locale: Locale, brandName: string) =>
  buildClaimEmailVerificationEmail({
    recipientEmail: EMAIL,
    brandName,
    verifyUrl: `${SITE_URL}/verify/abc`,
    siteUrl: SITE_URL,
    locale,
  })

const claimApproved = (locale: Locale, brandName: string) =>
  buildClaimApprovedEmail({
    ownerEmail: EMAIL,
    brandName,
    brandSlug: 'test-brand',
    siteUrl: SITE_URL,
    locale,
  })

const claimRejected = (locale: Locale, brandName: string) =>
  buildClaimRejectedEmail({
    ownerEmail: EMAIL,
    brandName,
    reviewerNotes: 'Insufficient proof',
    siteUrl: SITE_URL,
    locale,
  })

const ownershipRevoked = (brandName: string) =>
  buildOwnershipRevokedEmail({
    ownerEmail: EMAIL,
    brandName,
    reason: 'Ownership could not be verified',
  })

const editApproved = (locale: Locale, brandName: string) =>
  buildEditApprovedEmail({
    ownerEmail: EMAIL,
    brandName,
    locale,
  })

const editRejected = (locale: Locale, brandName: string) =>
  buildEditRejectedEmail({
    ownerEmail: EMAIL,
    brandName,
    notes: 'Insufficient detail',
    locale,
  })

const welcome = (locale: Locale, brandName: string) =>
  buildWelcomeEmail({
    to: EMAIL,
    brandName,
    brandSlug: 'test-brand',
    unsubscribeToken: 'welcome-token',
    locale,
  })

const profileNudge = (locale: Locale, brandName: string) =>
  buildProfileNudgeEmail({
    to: EMAIL,
    brandName,
    completenessPercent: 60,
    missingFields: ['description'],
    unsubscribeToken: 'profile-token',
    locale,
  })

const micrositeSpotlight = (locale: Locale, brandName: string) =>
  buildMicrositeSpotlightEmail({
    to: EMAIL,
    brandName,
    brandSlug: 'test-brand',
    unsubscribeToken: 'microsite-token',
    locale,
  })

const reEngagement = (locale: Locale, brandName: string) =>
  buildReEngagementEmail({
    to: EMAIL,
    brandName,
    brandSlug: 'test-brand',
    unsubscribeToken: 'reengagement-token',
    locale,
  })

const newsletterConfirm = (locale: Locale) =>
  buildNewsletterConfirmEmail({
    to: EMAIL,
    confirmToken: 'newsletter-token',
    unsubscribeToken: 'newsletter-unsubscribe-token',
    interests: ['brand-stories'],
    locale,
  })

const SUBJECT_CASES: SubjectCase[] = [
  {
    name: 'claim-submitted',
    locale: 'zh-TW',
    build: () => claimSubmitted('zh-TW', ZH_BRAND),
    expected: '認領「測試品牌」的品牌頁面 — Formoria',
    includesBrandName: true,
  },
  {
    name: 'claim-submitted',
    locale: 'en',
    build: () => claimSubmitted('en', EN_BRAND),
    expected: 'Claim your brand page for "Test Brand" — Formoria',
    includesBrandName: true,
  },
  {
    name: 'submission-approved',
    locale: 'zh-TW',
    build: () => approval('zh-TW', ZH_BRAND),
    expected: '您的品牌「測試品牌」已通過審核 — Formoria',
    includesBrandName: true,
  },
  {
    name: 'submission-approved',
    locale: 'en',
    build: () => approval('en', EN_BRAND),
    expected: 'Your brand "Test Brand" has been approved — Formoria',
    includesBrandName: true,
  },
  {
    name: 'submission-rejected',
    locale: 'zh-TW',
    build: () => rejection('zh-TW', ZH_BRAND),
    expected: 'Formoria：您提交的「測試品牌」需要修改',
    includesBrandName: true,
    allowsPrefixException: true,
  },
  {
    name: 'submission-rejected',
    locale: 'en',
    build: () => rejection('en', EN_BRAND),
    expected: '[Action Needed] Your Formoria submission needs attention',
    allowsPrefixException: true,
  },
  {
    name: 'claim-verified',
    locale: 'zh-TW',
    build: () => claimVerification('zh-TW', ZH_BRAND),
  },
  {
    name: 'claim-verified',
    locale: 'en',
    build: () => claimVerification('en', EN_BRAND),
  },
  {
    name: 'claim-approved',
    locale: 'zh-TW',
    build: () => claimApproved('zh-TW', ZH_BRAND),
    expected: '您的品牌認領申請「測試品牌」已通過審核 — Formoria',
    includesBrandName: true,
  },
  {
    name: 'claim-approved',
    locale: 'en',
    build: () => claimApproved('en', EN_BRAND),
    expected: 'Your brand claim for "Test Brand" has been approved — Formoria',
    includesBrandName: true,
  },
  {
    name: 'claim-rejected',
    locale: 'zh-TW',
    build: () => claimRejected('zh-TW', ZH_BRAND),
    expected: '您的品牌認領申請「測試品牌」未通過審核 — Formoria',
    includesBrandName: true,
  },
  {
    name: 'claim-rejected',
    locale: 'en',
    build: () => claimRejected('en', EN_BRAND),
    expected: 'Your brand claim for "Test Brand" was not approved — Formoria',
    includesBrandName: true,
  },
  {
    name: 'ownership-revoked',
    locale: 'zh-TW',
    build: () => ownershipRevoked(ZH_BRAND),
    expected: '「測試品牌」品牌管理權限已移除 / Brand management access removed — Formoria',
    includesBrandName: true,
  },
  {
    name: 'edit-approved',
    locale: 'zh-TW',
    build: () => editApproved('zh-TW', ZH_BRAND),
    includesBrandName: true,
  },
  {
    name: 'edit-approved',
    locale: 'en',
    build: () => editApproved('en', EN_BRAND),
    includesBrandName: true,
  },
  {
    name: 'edit-rejected',
    locale: 'zh-TW',
    build: () => editRejected('zh-TW', ZH_BRAND),
    includesBrandName: true,
  },
  {
    name: 'edit-rejected',
    locale: 'en',
    build: () => editRejected('en', EN_BRAND),
    includesBrandName: true,
  },
  {
    name: 'welcome',
    locale: 'zh-TW',
    build: () => welcome('zh-TW', ZH_BRAND),
    includesBrandName: true,
  },
  {
    name: 'welcome',
    locale: 'en',
    build: () => welcome('en', EN_BRAND),
    includesBrandName: true,
  },
  {
    name: 'profile-nudge',
    locale: 'zh-TW',
    build: () => profileNudge('zh-TW', ZH_BRAND),
    includesBrandName: true,
  },
  {
    name: 'profile-nudge',
    locale: 'en',
    build: () => profileNudge('en', EN_BRAND),
    includesBrandName: true,
  },
  {
    name: 'microsite-spotlight',
    locale: 'zh-TW',
    build: () => micrositeSpotlight('zh-TW', ZH_BRAND),
    includesBrandName: true,
  },
  {
    name: 'microsite-spotlight',
    locale: 'en',
    build: () => micrositeSpotlight('en', EN_BRAND),
    includesBrandName: true,
  },
  {
    name: 're-engagement',
    locale: 'zh-TW',
    build: () => reEngagement('zh-TW', ZH_BRAND),
    includesBrandName: true,
  },
  {
    name: 're-engagement',
    locale: 'en',
    build: () => reEngagement('en', EN_BRAND),
    includesBrandName: true,
  },
  {
    name: 'newsletter-confirm',
    locale: 'zh-TW',
    build: () => newsletterConfirm('zh-TW'),
  },
  {
    name: 'newsletter-confirm',
    locale: 'en',
    build: () => newsletterConfirm('en'),
  },
]

describe('email subject line consistency', () => {
  it.each(SUBJECT_CASES)('$name $locale subject follows Formoria formatting', async (testCase) => {
    const email = await testCase.build()

    if (testCase.expected) {
      expect(email.subject).toBe(testCase.expected)
    }

    if (!testCase.allowsPrefixException) {
      expect(email.subject).toMatch(/— Formoria$/)
    }

    expect(email.subject).not.toContain('- Formoria')
    expect(email.subject).not.toContain('/ Formoria')

    if (testCase.includesBrandName && testCase.locale === 'zh-TW') {
      expect(email.subject).toContain(`「${ZH_BRAND}」`)
      expect(email.subject).not.toContain(`"${ZH_BRAND}"`)
    }

    if (testCase.includesBrandName && testCase.locale === 'en') {
      expect(email.subject).toContain(`"${EN_BRAND}"`)
      expect(email.subject).not.toContain(`「${EN_BRAND}」`)
    }
  })
})
