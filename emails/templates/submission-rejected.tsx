import * as React from 'react'
import { Text } from '@react-email/components'
import { render } from '@react-email/render'
import { Button } from '@emails/components/button'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Layout } from '@emails/components/layout'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'

type Locale = 'zh-TW' | 'en'

type RejectionEmailProps = {
  submitterEmail: string
  brandName: string
  reviewerNotes: string | null
  locale?: Locale
}

type RejectionTemplateProps = Omit<RejectionEmailProps, 'submitterEmail' | 'reviewerNotes'> & {
  brandNameHtml: string
  locale: Locale
  reviewerNotesHtml: string | null
}

export default function SubmissionRejectedEmail({
  brandNameHtml,
  locale,
  reviewerNotesHtml,
}: RejectionTemplateProps) {
  if (locale === 'en') {
    return (
      <Layout previewText="Your submission needs revision">
        <EmailHeading>Your submission needs revision</EmailHeading>
        <EmailText>
          Thank you for submitting <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} /> to Formoria.
        </EmailText>
        <EmailText>After review, we are unable to approve this submission at this time.</EmailText>
        {reviewerNotesHtml ? <ReviewerNotes label="Reviewer notes:" notesHtml={reviewerNotesHtml} /> : null}
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
      <EmailText>經審核後，我們目前無法批准此次提交。</EmailText>
      {reviewerNotesHtml ? <ReviewerNotes label="審核意見：" notesHtml={reviewerNotesHtml} /> : null}
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
      ? `Your brand submission "${brandName}" needs revision — Formoria`
      : `您提交的品牌「${brandName}」需要修改 — Formoria`

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject,
    html: await render(
      <SubmissionRejectedEmail
        brandName={params.brandName}
        brandNameHtml={brandName}
        locale={locale}
        reviewerNotesHtml={reviewerNotes}
      />
    ),
  }
}
