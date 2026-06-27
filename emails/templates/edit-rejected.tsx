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

type EditRejectedEmailParams = {
  brandName: string
  ownerEmail: string
  notes?: string
  locale?: Locale
}

type EditRejectedTemplateProps = {
  brandNameHtml: string
  reviewerNotesHtml?: string
  locale: Locale
}

export default function EditRejectedEmail({
  brandNameHtml,
  reviewerNotesHtml,
  locale,
}: EditRejectedTemplateProps) {
  if (locale === 'en') {
    return (
      <Layout previewText="Your brand edit was not approved">
        <EmailHeading>Your brand edit was not approved</EmailHeading>
        <EmailText>
          Thank you for submitting updates for <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} />.
        </EmailText>
        <EmailText>After review, we are unable to approve this edit at this time.</EmailText>
        {reviewerNotesHtml ? (
          <ReviewerNotes
            label="Reviewer notes:"
            notesHtml={reviewerNotesHtml}
          />
        ) : null}
        <EmailText>You are welcome to revise and submit again.</EmailText>
        <Button href={SITE_URL}>Visit Formoria</Button>
      </Layout>
    )
  }

  return (
    <Layout previewText="您的品牌編輯未通過審核">
      <EmailHeading>您的品牌編輯未通過審核</EmailHeading>
      <EmailText>
        感謝您提交 <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} /> 的品牌資料更新。
      </EmailText>
      <EmailText>經審核後，我們目前無法批准此次編輯。</EmailText>
      {reviewerNotesHtml ? (
        <ReviewerNotes
          label="審核意見："
          notesHtml={reviewerNotesHtml}
        />
      ) : null}
      <EmailText>您可以依照審核意見調整後再次提交。</EmailText>
      <Button href={SITE_URL}>前往 Formoria</Button>
    </Layout>
  )
}

function ReviewerNotes({ label, notesHtml }: { label: string; notesHtml: string }) {
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

export function buildEditRejectedEmail(params: EditRejectedEmailParams): Promise<EmailMessage>
export function buildEditRejectedEmail(
  brandName: string,
  ownerEmail: string,
  notes?: string,
  locale?: Locale
): Promise<EmailMessage>
export async function buildEditRejectedEmail(
  paramsOrBrandName: EditRejectedEmailParams | string,
  ownerEmail?: string,
  notes?: string,
  locale?: Locale
): Promise<EmailMessage> {
  const params =
    typeof paramsOrBrandName === 'string'
      ? { brandName: paramsOrBrandName, ownerEmail: ownerEmail ?? '', notes, locale }
      : paramsOrBrandName
  const selectedLocale = params.locale ?? 'zh-TW'
  const escapedBrandName = escapeHtml(params.brandName)
  const reviewerNotes = params.notes?.trim() ?? ''
  const reviewerNotesHtml = reviewerNotes !== '' ? escapeHtml(reviewerNotes) : undefined
  const subject =
    selectedLocale === 'en'
      ? `Your brand edit "${escapedBrandName}" was not approved — Formoria`
      : `您的品牌編輯「${escapedBrandName}」未通過審核 — Formoria`

  return {
    to: params.ownerEmail,
    from: FROM_ADDRESS,
    subject,
    html: await render(
      <EditRejectedEmail
        brandNameHtml={escapedBrandName}
        locale={selectedLocale}
        reviewerNotesHtml={reviewerNotesHtml}
      />
    ),
  }
}
