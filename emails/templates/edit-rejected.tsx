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

type EditRejectedTemplateProps = {
  brandNameHtml: string
  reviewerNotesHtml?: string
}

export default function EditRejectedEmail({
  brandNameHtml,
  reviewerNotesHtml,
}: EditRejectedTemplateProps) {
  return (
    <Layout previewText="您的品牌編輯未通過審核">
      <EmailHeading>您的品牌編輯未通過審核</EmailHeading>
      <EmailText>
        感謝您提交 <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} /> 的品牌資料更新。
      </EmailText>
      <EmailText>經審核後，我們目前無法批准此次編輯。</EmailText>
      <EmailText>
        Thank you for submitting updates for <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} />.
      </EmailText>
      <EmailText>After review, we are unable to approve this edit at this time.</EmailText>
      {reviewerNotesHtml ? <ReviewerNotes notesHtml={reviewerNotesHtml} /> : null}
      <EmailText>您可以依照審核意見調整後再次提交。You are welcome to revise and submit again.</EmailText>
      <Button href={SITE_URL}>前往 Formoria / Visit Formoria</Button>
    </Layout>
  )
}

function ReviewerNotes({ notesHtml }: { notesHtml: string }) {
  return (
    <>
      <EmailText>
        <strong>審核意見 / Reviewer notes:</strong>
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

export async function buildEditRejectedEmail(
  brandName: string,
  ownerEmail: string,
  notes?: string
): Promise<EmailMessage> {
  const escapedBrandName = escapeHtml(brandName)
  const reviewerNotes = notes?.trim() ?? ''
  const reviewerNotesHtml = reviewerNotes !== '' ? escapeHtml(reviewerNotes) : undefined

  return {
    to: ownerEmail,
    from: FROM_ADDRESS,
    subject: `您的品牌編輯「${escapedBrandName}」未通過審核 / Your brand edit was not approved — Formoria`,
    html: await render(
      <EditRejectedEmail
        brandNameHtml={escapedBrandName}
        reviewerNotesHtml={reviewerNotesHtml}
      />
    ),
  }
}
