import * as React from 'react'
import { render } from '@react-email/render'
import { Button } from '@emails/components/button'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Layout } from '@emails/components/layout'
import { FROM_ADDRESS } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'

type Locale = 'zh-TW' | 'en'

type MissingFieldCode =
  | 'brand_name_empty'
  | 'website_url_invalid'
  | 'submitter_email_invalid'
  | 'description_too_short'
  | 'missing_description'
  | 'missing_category'
  | string

type IncompleteSubmissionEmailProps = {
  submitterEmail: string
  brandName: string
  missingFields: MissingFieldCode[]
  siteUrl: string
  locale?: Locale
}

type IncompleteTemplateProps = Omit<IncompleteSubmissionEmailProps, 'submitterEmail'> & {
  brandNameHtml: string
  fieldLabels: string[]
  locale: Locale
}

const ERROR_LABELS: Record<string, { 'zh-TW': string; en: string }> = {
  brand_name_empty: { 'zh-TW': '品牌名稱為必填', en: 'Brand name is required' },
  website_url_invalid: { 'zh-TW': '網站 URL 格式不正確', en: 'Website URL is not valid' },
  submitter_email_invalid: { 'zh-TW': '提交者電子郵件格式不正確', en: 'Submitter email is not valid' },
  description_too_short: { 'zh-TW': '品牌介紹過短（至少需要 20 個字元）', en: 'Description is too short (minimum 20 characters)' },
  missing_description: { 'zh-TW': '品牌介紹缺漏', en: 'Brand description is missing' },
  missing_category: { 'zh-TW': '品牌分類缺漏', en: 'Brand category is missing' },
}

export default function SubmissionIncompleteEmail({
  brandNameHtml,
  fieldLabels,
  locale,
  siteUrl,
}: IncompleteTemplateProps) {
  if (locale === 'en') {
    return (
      <Layout previewText="Your submission needs attention">
        <EmailHeading>Your submission needs attention</EmailHeading>
        <EmailText>
          Thank you for submitting <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} /> to Formoria.
        </EmailText>
        <EmailText>We found the following issues with your submission:</EmailText>
        <ul>
          {fieldLabels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
        <EmailText>Please update your submission so we can continue the review process.</EmailText>
        <Button href={siteUrl}>Update submission</Button>
      </Layout>
    )
  }

  return (
    <Layout previewText="您的提交需要補充資料">
      <EmailHeading>您的提交需要補充資料</EmailHeading>
      <EmailText>
        感謝您向 Formoria 提交 <strong dangerouslySetInnerHTML={{ __html: brandNameHtml }} />。
      </EmailText>
      <EmailText>我們發現您的提交有以下問題：</EmailText>
      <ul>
        {fieldLabels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
      <EmailText>請更新您的提交資料，以便我們繼續審核流程。</EmailText>
      <Button href={siteUrl}>更新提交資料</Button>
    </Layout>
  )
}

export async function buildIncompleteSubmissionEmail(
  params: IncompleteSubmissionEmailProps
): Promise<EmailMessage> {
  const locale = params.locale ?? 'zh-TW'
  const brandName = escapeHtml(params.brandName)
  const fieldLabels = params.missingFields.map((code) => ERROR_LABELS[code]?.[locale] ?? code)
  const subject =
    locale === 'en'
      ? `Action needed: please review your submission for "${brandName}" — Formoria`
      : `請確認您提交的品牌「${brandName}」— Formoria`

  return {
    to: params.submitterEmail,
    from: FROM_ADDRESS,
    subject,
    html: await render(
      <SubmissionIncompleteEmail
        brandName={params.brandName}
        brandNameHtml={brandName}
        fieldLabels={fieldLabels}
        locale={locale}
        missingFields={params.missingFields}
        siteUrl={params.siteUrl}
      />
    ),
  }
}
