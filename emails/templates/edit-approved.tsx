import * as React from 'react'
import { render } from '@react-email/render'
import { Button } from '@emails/components/button'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Layout } from '@emails/components/layout'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'

type Locale = 'zh-TW' | 'en'

type EditApprovedEmailParams = {
  brandName: string
  ownerEmail: string
  locale?: Locale
}

type EditApprovedTemplateProps = {
  brandNameHtml: string
  locale: Locale
}

export default function EditApprovedEmail({ brandNameHtml, locale }: EditApprovedTemplateProps) {
  if (locale === 'en') {
    return (
      <Layout previewText="Your brand edit has been approved!">
        <EmailHeading>Your brand edit has been approved!</EmailHeading>
        <EmailText>
          Your edits for <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} /> have been approved and are now
          live on Formoria.
        </EmailText>
        <Button href={SITE_URL}>Visit Formoria</Button>
      </Layout>
    )
  }

  return (
    <Layout previewText="您的品牌編輯已通過審核！">
      <EmailHeading>您的品牌編輯已通過審核！</EmailHeading>
      <EmailText>
        <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} /> 的品牌資料更新已通過審核，變更已正式刊登於 Formoria。
      </EmailText>
      <Button href={SITE_URL}>前往 Formoria</Button>
    </Layout>
  )
}

export function buildEditApprovedEmail(params: EditApprovedEmailParams): Promise<EmailMessage>
export function buildEditApprovedEmail(
  brandName: string,
  ownerEmail: string,
  locale?: Locale
): Promise<EmailMessage>
export async function buildEditApprovedEmail(
  paramsOrBrandName: EditApprovedEmailParams | string,
  ownerEmail?: string,
  locale?: Locale
): Promise<EmailMessage> {
  const params =
    typeof paramsOrBrandName === 'string'
      ? { brandName: paramsOrBrandName, ownerEmail: ownerEmail ?? '', locale }
      : paramsOrBrandName
  const selectedLocale = params.locale ?? 'zh-TW'
  const escapedBrandName = escapeHtml(params.brandName)
  const subject =
    selectedLocale === 'en'
      ? `Your brand edit "${escapedBrandName}" has been approved — Formoria`
      : `您的品牌編輯「${escapedBrandName}」已通過審核 — Formoria`

  return {
    to: params.ownerEmail,
    from: FROM_ADDRESS,
    subject,
    html: await render(
      <EditApprovedEmail
        brandNameHtml={escapedBrandName}
        locale={selectedLocale}
      />
    ),
  }
}
