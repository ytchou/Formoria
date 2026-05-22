import type { EmailMessage } from './types'
import type { ValidationErrorCode } from '../validation/types'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const FROM_ADDRESS = 'MIT Map <noreply@mitmap.tw>'

const ERROR_LABELS: Record<ValidationErrorCode, string> = {
  brand_name_empty: '品牌名稱為必填',
  website_url_invalid: '網站 URL 格式不正確',
  submitter_email_invalid: '提交者電子郵件格式不正確',
  description_too_short: '品牌介紹過短（至少需要 20 個字元）',
}

export function buildApprovalEmail(params: {
  submitterEmail: string
  brandName: string
  brandSlug: string
  siteUrl: string
}): EmailMessage {
  const brandUrl = `${params.siteUrl}/brands/${params.brandSlug}`

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject: `您的品牌「${escapeHtml(params.brandName)}」已通過審核 — MIT Map`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>您的品牌已通過審核！</h2>
        <p>好消息 —— <strong>${escapeHtml(params.brandName)}</strong> 現已刊登於 MIT Map。</p>
        <p>您可以在此查看您的品牌頁面：</p>
        <p><a href="${brandUrl}" style="color: #2563eb;">${brandUrl}</a></p>
        <p>感謝您為台灣品牌目錄做出貢獻。</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">MIT Map — 台灣品牌目錄</p>
      </div>
    `.trim(),
  }
}

export function buildRejectionEmail(params: {
  submitterEmail: string
  brandName: string
  reviewerNotes: string | null
}): EmailMessage {
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
    subject: `您提交的品牌「${escapeHtml(params.brandName)}」需要修改 — MIT Map`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>您的提交需要修改</h2>
        <p>感謝您向 MIT Map 提交 <strong>${escapeHtml(params.brandName)}</strong>。</p>
        <p>經審核後，我們目前無法批准此次提交。</p>
        ${notesSection}
        <p>您可以修改資料後重新提交。</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">MIT Map — 台灣品牌目錄</p>
      </div>
    `.trim(),
  }
}

export function buildClaimEmail(params: {
  submitterEmail: string
  brandName: string
  claimUrl: string
  siteUrl: string
}): EmailMessage {
  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject: `認領您在 MIT Map 的品牌頁面 — ${escapeHtml(params.brandName)}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>恭喜！您的品牌已通過審核。</h2>
        <p><strong>${escapeHtml(params.brandName)}</strong> 現已刊登於 MIT Map。</p>
        <p>身為品牌擁有者，您可以認領您的品牌頁面，直接管理和編輯您的品牌資訊。</p>
        <p style="margin: 24px 0;">
          <a href="${params.claimUrl}" style="display: inline-block; background-color: #E06B3F; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">認領您的品牌</a>
        </p>
        <p style="color: #6b7280; font-size: 14px;">此連結將在 7 天後失效。如果您並未提交此品牌，可安全忽略此郵件。</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">MIT Map — 台灣品牌目錄</p>
      </div>
    `.trim(),
  }
}

export function buildIncompleteSubmissionEmail(params: {
  submitterEmail: string
  brandName: string
  missingFields: ValidationErrorCode[]
  siteUrl: string
}): EmailMessage {
  const fieldList = params.missingFields
    .map((code) => `<li>${ERROR_LABELS[code]}</li>`)
    .join('\n')

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject: `請確認您提交的品牌「${escapeHtml(params.brandName)}」— MIT Map`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>您的提交需要補充資料</h2>
        <p>感謝您向 MIT Map 提交 <strong>${escapeHtml(params.brandName)}</strong>。</p>
        <p>我們發現您的提交有以下問題：</p>
        <ul>${fieldList}</ul>
        <p>請更新您的提交資料，以便我們繼續審核流程。</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="color: #6b7280; font-size: 14px;">MIT Map — 台灣品牌目錄</p>
      </div>
    `.trim(),
  }
}
