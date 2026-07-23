import * as React from 'react'
import { Link, Text } from '@react-email/components'
import { render } from '@react-email/render'
import { Button } from '@emails/components/button'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Layout } from '@emails/components/layout'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'
import type { DenialReason } from '@/lib/types'

type Locale = 'zh-TW' | 'en'

type RejectionEmailProps = {
  submitterEmail: string
  brandName: string
  denialReason: DenialReason
  reviewerNotes: string | null
  locale?: Locale
}

type RejectionTemplateProps = Omit<RejectionEmailProps, 'submitterEmail' | 'reviewerNotes'> & {
  brandNameHtml: string
  locale: Locale
  reviewerNotesHtml: string | null
}

const DENIAL_GUIDANCE: Record<DenialReason, { en: string; zh: string }> = {
  not_mit: {
    en: "We couldn't verify that this brand is founded, designed, or made in Taiwan. Please provide documentation showing the brand's connection to Taiwan.",
    zh: '我們無法確認此品牌在台灣創立、設計或製造。請提供說明品牌與台灣連結的相關文件。',
  },
  insufficient_info: {
    en: 'The submission is missing key details. Please add a complete description and product photos.',
    zh: '提交內容缺少關鍵資訊。請補充完整描述和產品照片。',
  },
  duplicate: {
    en: 'This brand has already been submitted. If you believe this is in error, please contact us.',
    zh: '此品牌已經提交過。如果您認為這是錯誤，請聯絡我們。',
  },
  policy_violation: {
    en: "This submission doesn't meet our community guidelines.",
    zh: '此提交內容不符合我們的社群規範。',
  },
  admin_reject: {
    en: 'This submission was not approved after admin review.',
    zh: '此提交經管理員審核後未通過。',
  },
  other: {
    en: 'Please see the reviewer notes below for details.',
    zh: '請參閱下方審核意見以了解詳細資訊。',
  },
}

const DENIAL_REASON_LABELS: Record<DenialReason, { en: string; zh: string }> = {
  not_mit: {
    en: 'Not a Taiwanese Brand',
    zh: '非台灣品牌',
  },
  insufficient_info: {
    en: 'Insufficient Information',
    zh: '資訊不足',
  },
  duplicate: {
    en: 'Duplicate Submission',
    zh: '重複提交',
  },
  policy_violation: {
    en: 'Policy Violation',
    zh: '違反政策',
  },
  admin_reject: {
    en: 'Admin Rejected',
    zh: '管理員拒絕',
  },
  other: {
    en: 'Other',
    zh: '其他',
  },
}

export default function SubmissionRejectedEmail({
  brandNameHtml,
  denialReason,
  locale,
  reviewerNotesHtml,
}: RejectionTemplateProps) {
  const copyKey = locale === 'en' ? 'en' : 'zh'
  const denialReasonLabel = DENIAL_REASON_LABELS[denialReason][copyKey]
  const guidance = DENIAL_GUIDANCE[denialReason][copyKey]

  if (locale === 'en') {
    return (
      <Layout previewText="Your submission needs revision">
        <EmailHeading>Your submission needs revision</EmailHeading>
        <EmailText>
          Thank you for submitting <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} /> to Formoria.
        </EmailText>
        <EmailText>
          <strong>Denial reason:</strong> {denialReasonLabel}
        </EmailText>
        <EmailText>After review, we are unable to approve this submission at this time.</EmailText>
        <EmailText>{guidance}</EmailText>
        {reviewerNotesHtml ? <ReviewerNotes label="Reviewer notes:" notesHtml={reviewerNotesHtml} /> : null}
        <EmailText>
          If you believe this decision was made in error, contact us at{' '}
          <Link href="mailto:ops@formoria.com">ops@formoria.com</Link>.
        </EmailText>
        <EmailText>You are welcome to revise and resubmit.</EmailText>
        <Button href={SITE_URL}>Visit Formoria</Button>
      </Layout>
    )
  }

  return (
    <Layout previewText="您的提交需要修改">
      <EmailHeading>您的提交需要修改</EmailHeading>
      <EmailText>
        感謝您向 Formoria 提交 <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} />。
      </EmailText>
      <EmailText>
        <strong>拒絕原因：</strong>
        {denialReasonLabel}
      </EmailText>
      <EmailText>經審核後，我們目前無法批准此次提交。</EmailText>
      <EmailText>{guidance}</EmailText>
      {reviewerNotesHtml ? <ReviewerNotes label="審核意見：" notesHtml={reviewerNotesHtml} /> : null}
      <EmailText>
        如果您認為此決定有誤，請透過 <Link href="mailto:ops@formoria.com">ops@formoria.com</Link> 聯絡我們。
      </EmailText>
      <EmailText>您可以修改資料後重新提交。</EmailText>
      <Button href={SITE_URL}>前往 Formoria</Button>
    </Layout>
  )
}

function ReviewerNotes({
  label,
  notesHtml,
}: {
  label: string
  notesHtml: string
}) {
  return (
    <>
      <EmailText>
        <strong>{label}</strong>
      </EmailText>
      <Text style={blockquote} dangerouslySetInnerHTML={{ __html: notesHtml }} />
    </>
  )
}

const blockquote = {
  borderLeft: '3px solid #d1d5db',
  color: '#374151',
  margin: '0 0 16px',
  paddingLeft: '12px',
}

export async function buildRejectionEmail(params: RejectionEmailProps): Promise<EmailMessage> {
  const locale = params.locale ?? 'zh-TW'
  const brandName = escapeHtml(params.brandName)
  const reviewerNotes = params.reviewerNotes != null ? escapeHtml(params.reviewerNotes) : null
  const subject =
    locale === 'en'
      ? '[Action Needed] Your Formoria submission needs attention'
      : `Formoria：您提交的「${brandName}」需要修改`

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject,
    html: await render(
      <SubmissionRejectedEmail
        brandName={params.brandName}
        brandNameHtml={brandName}
        denialReason={params.denialReason}
        locale={locale}
        reviewerNotesHtml={reviewerNotes}
      />
    ),
  }
}
