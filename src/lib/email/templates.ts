import type { EmailMessage } from './types'
import type { ValidationErrorCode } from '../validation/types'
import { CONTACT_EMAILS } from '@/lib/constants'

type Locale = 'zh-TW' | 'en'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const FROM_ADDRESS = `Formoria <${CONTACT_EMAILS.noreply}>`
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://formoria.com'
const MICROSITE_HOST = process.env.MICROSITE_HOST ?? 'brand.formoria.com'

function unsubscribeUrl(token: string): string {
  return SITE_URL + '/api/email/unsubscribe?token=' + token
}

function unsubscribeFooter(token: string): string {
  return '<p style="color:#888;font-size:12px;margin-top:32px;">如不希望收到此類郵件，請<a href="' + unsubscribeUrl(token) + '">點此取消訂閱</a>。<br>To unsubscribe from lifecycle emails, <a href="' + unsubscribeUrl(token) + '">click here</a>.</p>'
}

function listUnsubscribeHeaders(token: string): Record<string, string> {
  return {
    'List-Unsubscribe': '<' + unsubscribeUrl(token) + '>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

const ERROR_LABELS: Record<ValidationErrorCode, { 'zh-TW': string; en: string }> = {
  brand_name_empty: { 'zh-TW': '品牌名稱為必填', en: 'Brand name is required' },
  website_url_invalid: { 'zh-TW': '網站 URL 格式不正確', en: 'Website URL is not valid' },
  submitter_email_invalid: { 'zh-TW': '提交者電子郵件格式不正確', en: 'Submitter email is not valid' },
  description_too_short: { 'zh-TW': '品牌介紹過短（至少需要 20 個字元）', en: 'Description is too short (minimum 20 characters)' },
}

export function buildApprovalEmail(params: {
  submitterEmail: string
  brandName: string
  brandSlug: string
  siteUrl: string
  locale?: Locale
}): EmailMessage {
  const locale = params.locale ?? 'zh-TW'
  const brandUrl = `${params.siteUrl}/brands/${params.brandSlug}`

  if (locale === 'en') {
    return {
      to: params.submitterEmail,
      from: FROM_ADDRESS,
      subject: `Your brand "${escapeHtml(params.brandName)}" has been approved — Formoria`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Your brand has been approved!</h2>
          <p>Great news — <strong>${escapeHtml(params.brandName)}</strong> is now listed on Formoria.</p>
          <p>You can view your brand page here:</p>
          <p><a href="${brandUrl}" style="color: #2563eb;">${brandUrl}</a></p>
          <p>Thank you for contributing to the Made in Taiwan directory.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #6b7280; font-size: 14px;">Formoria — Made in Taiwan Brand Directory</p>
        </div>
      `.trim(),
    }
  }

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject: `您的品牌「${escapeHtml(params.brandName)}」已通過審核 — Formoria`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>您的品牌已通過審核！</h2>
        <p>好消息 —— <strong>${escapeHtml(params.brandName)}</strong> 現已刊登於 Formoria。</p>
        <p>您可以在此查看您的品牌頁面：</p>
        <p><a href="${brandUrl}" style="color: #2563eb;">${brandUrl}</a></p>
        <p>感謝您為台灣品牌目錄做出貢獻。</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria — 台灣品牌目錄</p>
      </div>
    `.trim(),
  }
}

export function buildRejectionEmail(params: {
  submitterEmail: string
  brandName: string
  reviewerNotes: string | null
  locale?: Locale
}): EmailMessage {
  const locale = params.locale ?? 'zh-TW'

  if (locale === 'en') {
    const notesSection =
      params.reviewerNotes != null
        ? `
        <p><strong>Reviewer notes:</strong></p>
        <blockquote style="border-left: 3px solid #d1d5db; padding-left: 12px; color: #374151;">
          ${escapeHtml(params.reviewerNotes)}
        </blockquote>`
        : ''

    return {
      to: params.submitterEmail,
      from: FROM_ADDRESS,
      subject: `Your brand submission "${escapeHtml(params.brandName)}" needs revision — Formoria`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Your submission needs revision</h2>
          <p>Thank you for submitting <strong>${escapeHtml(params.brandName)}</strong> to Formoria.</p>
          <p>After review, we are unable to approve this submission at this time.</p>
          ${notesSection}
          <p>You are welcome to revise and resubmit.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #6b7280; font-size: 14px;">Formoria — Made in Taiwan Brand Directory</p>
        </div>
      `.trim(),
    }
  }

  const notesSection =
    params.reviewerNotes != null
      ? `
        <p><strong>審核意見：</strong></p>
        <blockquote style="border-left: 3px solid #d1d5db; padding-left: 12px; color: #374151;">
          ${escapeHtml(params.reviewerNotes)}
        </blockquote>`
      : ''

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject: `您提交的品牌「${escapeHtml(params.brandName)}」需要修改 — Formoria`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>您的提交需要修改</h2>
        <p>感謝您向 Formoria 提交 <strong>${escapeHtml(params.brandName)}</strong>。</p>
        <p>經審核後，我們目前無法批准此次提交。</p>
        ${notesSection}
        <p>您可以修改資料後重新提交。</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria — 台灣品牌目錄</p>
      </div>
    `.trim(),
  }
}

export function buildClaimEmail(params: {
  submitterEmail: string
  brandName: string
  claimUrl: string
  siteUrl: string
  locale?: Locale
}): EmailMessage {
  const locale = params.locale ?? 'zh-TW'

  if (locale === 'en') {
    return {
      to: params.submitterEmail,
      from: FROM_ADDRESS,
      subject: `Claim your brand page on Formoria — ${escapeHtml(params.brandName)}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Congratulations! Your brand has been approved.</h2>
          <p><strong>${escapeHtml(params.brandName)}</strong> is now listed on Formoria.</p>
          <p>As the brand owner, you can claim your brand page to manage and edit your information directly.</p>
          <p style="margin: 24px 0;">
            <a href="${params.claimUrl}" style="display: inline-block; background-color: #E06B3F; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Claim your brand</a>
          </p>
          <p style="color: #6b7280; font-size: 14px;">This link expires in 7 days. If you did not submit this brand, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #6b7280; font-size: 14px;">Formoria — Made in Taiwan Brand Directory</p>
        </div>
      `.trim(),
    }
  }

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject: `認領您在 Formoria 的品牌頁面 — ${escapeHtml(params.brandName)}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>恭喜！您的品牌已通過審核。</h2>
        <p><strong>${escapeHtml(params.brandName)}</strong> 現已刊登於 Formoria。</p>
        <p>身為品牌擁有者，您可以認領您的品牌頁面，直接管理和編輯您的品牌資訊。</p>
        <p style="margin: 24px 0;">
          <a href="${params.claimUrl}" style="display: inline-block; background-color: #E06B3F; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">認領您的品牌</a>
        </p>
        <p style="color: #6b7280; font-size: 14px;">此連結將在 7 天後失效。如果您並未提交此品牌，可安全忽略此郵件。</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria — 台灣品牌目錄</p>
      </div>
    `.trim(),
  }
}

export function buildClaimEmailVerificationEmail(params: {
  recipientEmail: string
  brandName: string
  verifyUrl: string
  siteUrl: string
  locale?: Locale
}): EmailMessage {
  const locale = params.locale ?? 'zh-TW'
  const brandName = escapeHtml(params.brandName)
  const verifyUrl = escapeHtml(params.verifyUrl)
  const siteUrl = escapeHtml(params.siteUrl)

  if (locale === 'en') {
    return {
      to: params.recipientEmail,
      from: FROM_ADDRESS,
      subject: 'Verify your claim email — Formoria',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Verify your claim email</h2>
          <p>You requested to claim <strong>${brandName}</strong> on Formoria.</p>
          <p>Confirm that you control this email address by clicking the button below:</p>
          <p style="margin: 24px 0;">
            <a href="${verifyUrl}" style="display: inline-block; background-color: #E06B3F; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Verify email</a>
          </p>
          <p>If the button does not work, open this link:</p>
          <p><a href="${verifyUrl}" style="color: #2563eb;">${verifyUrl}</a></p>
          <p style="color: #6b7280; font-size: 14px;">This link expires in 7 days. If you did not request this claim, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #6b7280; font-size: 14px;">Formoria — Made in Taiwan Brand Directory</p>
          <p style="color: #9ca3af; font-size: 12px;"><a href="${siteUrl}" style="color: #9ca3af;">${siteUrl}</a></p>
        </div>
      `.trim(),
    }
  }

  return {
    to: params.recipientEmail,
    from: FROM_ADDRESS,
    subject: '驗證您的認領信箱 — Formoria',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>驗證您的認領信箱</h2>
        <p>您已申請認領 Formoria 上的 <strong>${brandName}</strong>。</p>
        <p>請點擊下方按鈕，確認您可控制此 Email 地址：</p>
        <p style="margin: 24px 0;">
          <a href="${verifyUrl}" style="display: inline-block; background-color: #E06B3F; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">驗證信箱</a>
        </p>
        <p>若按鈕無法使用，請開啟此連結：</p>
        <p><a href="${verifyUrl}" style="color: #2563eb;">${verifyUrl}</a></p>
        <p style="color: #6b7280; font-size: 14px;">此連結將在 7 天後失效。如果您並未提出此認領申請，可安全忽略此郵件。</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria — 台灣品牌目錄</p>
        <p style="color: #9ca3af; font-size: 12px;"><a href="${siteUrl}" style="color: #9ca3af;">${siteUrl}</a></p>
      </div>
    `.trim(),
  }
}

export function buildClaimApprovedEmail(params: {
  ownerEmail: string
  brandName: string
  brandSlug: string
  siteUrl: string
  locale?: Locale
}): EmailMessage {
  const locale = params.locale ?? 'zh-TW'
  const dashboardUrl = `${params.siteUrl}/dashboard?tab=${params.brandSlug}`

  if (locale === 'en') {
    return {
      to: params.ownerEmail,
      from: FROM_ADDRESS,
      subject: `Your brand claim for "${escapeHtml(params.brandName)}" has been approved — Formoria`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Your brand claim has been approved!</h2>
          <p>Congratulations. Your claim for <strong>${escapeHtml(params.brandName)}</strong> has been approved.</p>
          <p>You can now manage your brand from the owner dashboard.</p>
          <p style="margin: 24px 0;">
            <a href="${dashboardUrl}" style="display: inline-block; background-color: #E06B3F; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Go to owner dashboard</a>
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #6b7280; font-size: 14px;">Formoria — Made in Taiwan Brand Directory</p>
        </div>
      `.trim(),
    }
  }

  return {
    to: params.ownerEmail,
    from: FROM_ADDRESS,
    subject: `您的品牌認領申請「${escapeHtml(params.brandName)}」已通過審核 — Formoria`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>您的品牌認領申請已通過審核！</h2>
        <p>恭喜您，<strong>${escapeHtml(params.brandName)}</strong> 的品牌認領申請已獲批准。</p>
        <p>您現在可以前往品牌主後台管理品牌資訊。</p>
        <p style="margin: 24px 0;">
          <a href="${dashboardUrl}" style="display: inline-block; background-color: #E06B3F; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">前往品牌主後台</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria — 台灣品牌目錄</p>
      </div>
    `.trim(),
  }
}

export function buildClaimRejectedEmail(params: {
  ownerEmail: string
  brandName: string
  reviewerNotes: string
  siteUrl: string
  locale?: Locale
}): EmailMessage {
  const locale = params.locale ?? 'zh-TW'
  const reviewerNotes = params.reviewerNotes.trim()
  const notesSection =
    reviewerNotes !== ''
      ? `
        <p><strong>${locale === 'en' ? 'Reviewer notes' : '審核意見'}:</strong></p>
        <blockquote style="border-left: 3px solid #d1d5db; padding-left: 12px; color: #374151;">
          ${escapeHtml(reviewerNotes)}
        </blockquote>`
      : ''

  if (locale === 'en') {
    return {
      to: params.ownerEmail,
      from: FROM_ADDRESS,
      subject: `Your brand claim for "${escapeHtml(params.brandName)}" was not approved — Formoria`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Your brand claim was not approved</h2>
          <p>Thank you for submitting a claim for <strong>${escapeHtml(params.brandName)}</strong>.</p>
          <p>After review, we are unable to approve this claim at this time.</p>
          ${notesSection}
          <p>If you have more supporting information, please review your brand details on Formoria.</p>
          <p><a href="${params.siteUrl}" style="color: #2563eb;">${params.siteUrl}</a></p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #6b7280; font-size: 14px;">Formoria — Made in Taiwan Brand Directory</p>
        </div>
      `.trim(),
    }
  }

  return {
    to: params.ownerEmail,
    from: FROM_ADDRESS,
    subject: `您的品牌認領申請「${escapeHtml(params.brandName)}」未通過審核 — Formoria`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>您的品牌認領申請未通過審核</h2>
        <p>感謝您提交 <strong>${escapeHtml(params.brandName)}</strong> 的品牌認領申請。</p>
        <p>經審核後，我們目前無法批准此次申請。</p>
        ${notesSection}
        <p>若您有補充資料，可前往 Formoria 重新確認品牌資訊。</p>
        <p><a href="${params.siteUrl}" style="color: #2563eb;">${params.siteUrl}</a></p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria — 台灣品牌目錄</p>
      </div>
    `.trim(),
  }
}

export function buildEditApprovedEmail(brandName: string, ownerEmail: string): EmailMessage {
  const escapedBrandName = escapeHtml(brandName)

  return {
    to: ownerEmail,
    from: FROM_ADDRESS,
    subject: `您的品牌編輯「${escapedBrandName}」已通過審核 / Your brand edit has been approved — Formoria`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>您的品牌編輯已通過審核！</h2>
        <p><strong>${escapedBrandName}</strong> 的品牌資料更新已通過審核，變更已正式刊登於 Formoria。</p>
        <p>Your edits for <strong>${escapedBrandName}</strong> have been approved and are now live on Formoria.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria — 台灣品牌目錄 / Made in Taiwan Brand Directory</p>
      </div>
    `.trim(),
  }
}

export function buildEditRejectedEmail(
  brandName: string,
  ownerEmail: string,
  notes?: string
): EmailMessage {
  const escapedBrandName = escapeHtml(brandName)
  const reviewerNotes = notes?.trim() ?? ''
  const notesSection =
    reviewerNotes !== ''
      ? `
        <p><strong>審核意見 / Reviewer notes:</strong></p>
        <blockquote style="border-left: 3px solid #d1d5db; padding-left: 12px; color: #374151;">
          ${escapeHtml(reviewerNotes)}
        </blockquote>`
      : ''

  return {
    to: ownerEmail,
    from: FROM_ADDRESS,
    subject: `您的品牌編輯「${escapedBrandName}」未通過審核 / Your brand edit was not approved — Formoria`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>您的品牌編輯未通過審核</h2>
        <p>感謝您提交 <strong>${escapedBrandName}</strong> 的品牌資料更新。</p>
        <p>經審核後，我們目前無法批准此次編輯。</p>
        <p>Thank you for submitting updates for <strong>${escapedBrandName}</strong>.</p>
        <p>After review, we are unable to approve this edit at this time.</p>
        ${notesSection}
        <p>您可以依照審核意見調整後再次提交。You are welcome to revise and submit again.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria — 台灣品牌目錄 / Made in Taiwan Brand Directory</p>
      </div>
    `.trim(),
  }
}

export function buildIncompleteSubmissionEmail(params: {
  submitterEmail: string
  brandName: string
  missingFields: ValidationErrorCode[]
  siteUrl: string
  locale?: Locale
}): EmailMessage {
  const locale = params.locale ?? 'zh-TW'
  const fieldList = params.missingFields
    .map((code) => `<li>${ERROR_LABELS[code][locale]}</li>`)
    .join('\n')

  if (locale === 'en') {
    return {
      to: params.submitterEmail,
      from: FROM_ADDRESS,
      subject: `Action needed: please review your submission for "${escapeHtml(params.brandName)}" — Formoria`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Your submission needs attention</h2>
          <p>Thank you for submitting <strong>${escapeHtml(params.brandName)}</strong> to Formoria.</p>
          <p>We found the following issues with your submission:</p>
          <ul>${fieldList}</ul>
          <p>Please update your submission so we can continue the review process.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #6b7280; font-size: 14px;">Formoria — Made in Taiwan Brand Directory</p>
        </div>
      `.trim(),
    }
  }

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject: `請確認您提交的品牌「${escapeHtml(params.brandName)}」— Formoria`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>您的提交需要補充資料</h2>
        <p>感謝您向 Formoria 提交 <strong>${escapeHtml(params.brandName)}</strong>。</p>
        <p>我們發現您的提交有以下問題：</p>
        <ul>${fieldList}</ul>
        <p>請更新您的提交資料，以便我們繼續審核流程。</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria — 台灣品牌目錄</p>
      </div>
    `.trim(),
  }
}

export function buildMitVerificationSubmittedEmail(params: {
  to: string
  brandName: string
}): EmailMessage {
  const brandName = escapeHtml(params.brandName)

  return {
    to: params.to,
    from: FROM_ADDRESS,
    subject: `MIT verification submitted — ${brandName}`,
    replyTo: 'ops@formoria.com',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>MIT 驗證已收到</h2>
        <p>我們已收到 <strong>${brandName}</strong> 的 MIT 驗證申請，團隊將開始審核。</p>
        <p>We received your MIT verification submission for <strong>${brandName}</strong> and will review it shortly.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria — 台灣品牌目錄</p>
      </div>
    `.trim(),
  }
}

export function buildMitVerificationApprovedEmail(params: {
  to: string
  brandName: string
}): EmailMessage {
  const brandName = escapeHtml(params.brandName)

  return {
    to: params.to,
    from: FROM_ADDRESS,
    subject: `MIT verification approved — ${brandName}`,
    replyTo: 'ops@formoria.com',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>MIT 品牌已驗證</h2>
        <p><strong>${brandName}</strong> 的 MIT 驗證已通過，品牌頁面將顯示已驗證標章。</p>
        <p><strong>${brandName}</strong> is now verified and will show the verified badge on Formoria.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria — 台灣品牌目錄</p>
      </div>
    `.trim(),
  }
}

export function buildMitVerificationNeedsDocsEmail(params: {
  to: string
  brandName: string
  notes: string
}): EmailMessage {
  const brandName = escapeHtml(params.brandName)
  const notes = escapeHtml(params.notes)

  return {
    to: params.to,
    from: FROM_ADDRESS,
    subject: `MIT verification needs additional documents — ${brandName}`,
    replyTo: 'ops@formoria.com',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>MIT 驗證需要補充文件</h2>
        <p><strong>${brandName}</strong> 的 MIT 驗證需要補充文件後才能繼續審核。</p>
        <p>Please provide the additional documents requested below so we can continue the MIT verification review.</p>
        <blockquote style="border-left: 3px solid #d1d5db; padding-left: 12px; color: #374151;">
          ${notes}
        </blockquote>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">Formoria — 台灣品牌目錄</p>
      </div>
    `.trim(),
  }
}

export function buildWelcomeEmail(params: {
  to: string
  brandName: string
  brandSlug: string
  unsubscribeToken: string
}): EmailMessage {
  const brandName = escapeHtml(params.brandName)
  const brandSlug = escapeHtml(params.brandSlug)
  const dashboardUrl = `${SITE_URL}/dashboard`
  const micrositeUrl = `https://${MICROSITE_HOST}/${brandSlug}`

  return {
    to: params.to,
    from: FROM_ADDRESS,
    subject: `歡迎加入 Formoria — ${brandName}`,
    replyTo: 'ops@formoria.com',
    headers: listUnsubscribeHeaders(params.unsubscribeToken),
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>歡迎，${brandName}</h2>
        <p>您的品牌工作區已準備好。您可以前往後台管理品牌資料：</p>
        <p><a href="${dashboardUrl}" style="color: #2563eb;">${dashboardUrl}</a></p>
        <p>品牌微官網連結：</p>
        <p><a href="${micrositeUrl}" style="color: #2563eb;">${micrositeUrl}</a></p>
      </div>
      ${unsubscribeFooter(params.unsubscribeToken)}
    `.trim(),
  }
}

export function buildProfileNudgeEmail(params: {
  to: string
  brandName: string
  completenessPercent: number
  missingFields: string[]
  unsubscribeToken: string
}): EmailMessage {
  const brandName = escapeHtml(params.brandName)
  const missingFields = params.missingFields
    .map((field) => `<li>${escapeHtml(field)}</li>`)
    .join('\n')

  return {
    to: params.to,
    from: FROM_ADDRESS,
    subject: `完善 ${brandName} 的品牌資料 — Formoria`,
    replyTo: 'ops@formoria.com',
    headers: listUnsubscribeHeaders(params.unsubscribeToken),
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>讓 ${brandName} 的品牌頁更完整</h2>
        <p>目前資料完整度為 <strong>${params.completenessPercent}%</strong>。</p>
        <p>建議補齊以下欄位：</p>
        <ul>${missingFields}</ul>
      </div>
      ${unsubscribeFooter(params.unsubscribeToken)}
    `.trim(),
  }
}

export function buildMicrositeSpotlightEmail(params: {
  to: string
  brandName: string
  brandSlug: string
  unsubscribeToken: string
}): EmailMessage {
  const brandName = escapeHtml(params.brandName)
  const brandSlug = escapeHtml(params.brandSlug)
  const micrositeUrl = `https://${MICROSITE_HOST}/${brandSlug}`

  return {
    to: params.to,
    from: FROM_ADDRESS,
    subject: `${brandName} 的品牌官網已就緒 — Formoria`,
    replyTo: 'ops@formoria.com',
    headers: listUnsubscribeHeaders(params.unsubscribeToken),
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${brandName} 的品牌官網</h2>
        <p>您可以分享這個 Formoria 品牌官網，讓買家更快認識您的品牌：</p>
        <p><a href="${micrositeUrl}" style="color: #2563eb;">${micrositeUrl}</a></p>
      </div>
      ${unsubscribeFooter(params.unsubscribeToken)}
    `.trim(),
  }
}

export function buildReEngagementEmail(params: {
  to: string
  brandName: string
  brandSlug: string
  unsubscribeToken: string
}): EmailMessage {
  const brandName = escapeHtml(params.brandName)
  const brandSlug = escapeHtml(params.brandSlug)
  const dashboardUrl = `${SITE_URL}/dashboard?tab=${brandSlug}`

  return {
    to: params.to,
    from: FROM_ADDRESS,
    subject: `回來完善 ${brandName} 的品牌頁 — Formoria`,
    replyTo: 'ops@formoria.com',
    headers: listUnsubscribeHeaders(params.unsubscribeToken),
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>繼續完善 ${brandName}</h2>
        <p>您的品牌代稱是 <strong>${brandSlug}</strong>。完成品牌資料後，買家能更清楚了解您的產品與故事。</p>
        <p><a href="${dashboardUrl}" style="color: #2563eb;">回到品牌後台</a></p>
      </div>
      ${unsubscribeFooter(params.unsubscribeToken)}
    `.trim(),
  }
}
