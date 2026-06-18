import * as React from 'react'
import { render } from '@react-email/render'
import { Button } from '@emails/components/button'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Layout } from '@emails/components/layout'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'

type EditApprovedTemplateProps = {
  brandNameHtml: string
}

export default function EditApprovedEmail({ brandNameHtml }: EditApprovedTemplateProps) {
  return (
    <Layout previewText="您的品牌編輯已通過審核！">
      <EmailHeading>您的品牌編輯已通過審核！</EmailHeading>
      <EmailText>
        <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} /> 的品牌資料更新已通過審核，變更已正式刊登於 Formoria。
      </EmailText>
      <EmailText>
        Your edits for <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} /> have been approved and are now
        live on Formoria.
      </EmailText>
      <Button href={SITE_URL}>前往 Formoria / Visit Formoria</Button>
    </Layout>
  )
}

export async function buildEditApprovedEmail(
  brandName: string,
  ownerEmail: string
): Promise<EmailMessage> {
  const escapedBrandName = escapeHtml(brandName)

  return {
    to: ownerEmail,
    from: FROM_ADDRESS,
    subject: `您的品牌編輯「${escapedBrandName}」已通過審核 / Your brand edit has been approved — Formoria`,
    html: await render(<EditApprovedEmail brandNameHtml={escapedBrandName} />),
  }
}
