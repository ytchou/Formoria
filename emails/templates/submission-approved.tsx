import * as React from 'react'
import { Link } from '@react-email/components'
import { render } from '@react-email/render'
import { Button } from '@emails/components/button'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Layout } from '@emails/components/layout'
import { FROM_ADDRESS } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'

type Locale = 'zh-TW' | 'en'

type ApprovalEmailProps = {
  submitterEmail: string
  brandName: string
  brandSlug: string
  siteUrl: string
  locale?: Locale
}

type ApprovalTemplateProps = Omit<ApprovalEmailProps, 'submitterEmail'> & {
  brandNameHtml: string
  brandUrl: string
  locale: Locale
}

export default function SubmissionApprovedEmail({
  brandNameHtml,
  brandUrl,
  locale,
}: ApprovalTemplateProps) {
  if (locale === 'en') {
    return (
      <Layout previewText="Your brand has been approved!">
        <EmailHeading>Your brand has been approved!</EmailHeading>
        <EmailText>
          Great news - <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} /> is now listed on Formoria.
        </EmailText>
        <EmailText>You can view your brand page here:</EmailText>
        <EmailText>
          <Link href={brandUrl}>{brandUrl}</Link>
        </EmailText>
        <Button href={brandUrl}>View your brand page</Button>
        <EmailText>Thank you for contributing to the Made in Taiwan directory.</EmailText>
      </Layout>
    )
  }

  return (
    <Layout previewText="您的品牌已通過審核！">
      <EmailHeading>您的品牌已通過審核！</EmailHeading>
      <EmailText>
        好消息 - <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} /> 現已刊登於 Formoria。
      </EmailText>
      <EmailText>您可以在此查看您的品牌頁面：</EmailText>
      <EmailText>
        <Link href={brandUrl}>{brandUrl}</Link>
      </EmailText>
      <Button href={brandUrl}>查看品牌頁面</Button>
      <EmailText>感謝您為台灣品牌目錄做出貢獻。</EmailText>
    </Layout>
  )
}

export async function buildApprovalEmail(params: ApprovalEmailProps): Promise<EmailMessage> {
  const locale = params.locale ?? 'zh-TW'
  const brandName = escapeHtml(params.brandName)
  const brandUrl = `${params.siteUrl}/brands/${params.brandSlug}`
  const subject =
    locale === 'en'
      ? `Your brand "${brandName}" has been approved — Formoria`
      : `您的品牌「${brandName}」已通過審核 — Formoria`

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject,
    html: await render(
      <SubmissionApprovedEmail
        brandName={params.brandName}
        brandNameHtml={brandName}
        brandSlug={params.brandSlug}
        brandUrl={brandUrl}
        locale={locale}
        siteUrl={params.siteUrl}
      />
    ),
  }
}
