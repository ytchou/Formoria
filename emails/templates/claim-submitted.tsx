import { render } from '@react-email/render'
import { Layout } from '@emails/components/layout'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Button } from '@emails/components/button'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'

type Locale = 'zh-TW' | 'en'

type ClaimSubmittedEmailProps = {
  submitterEmail: string
  brandName: string
  claimUrl: string
  siteUrl?: string
  locale?: Locale
}

export default function ClaimSubmittedEmail({
  brandName,
  claimUrl,
  locale = 'zh-TW',
}: ClaimSubmittedEmailProps) {
  const escapedBrandName = escapeHtml(brandName)
  const escapedClaimUrl = escapeHtml(claimUrl)

  if (locale === 'en') {
    return (
      <Layout previewText={`Claim your brand page on Formoria - ${escapedBrandName}`}>
        <EmailHeading as="h2">Congratulations! Your brand has been approved.</EmailHeading>
        <EmailText>
          <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> is now listed on Formoria.
        </EmailText>
        <EmailText>
          As the brand owner, you can claim your brand page to manage and edit your information directly.
        </EmailText>
        <Button href={escapedClaimUrl}>Claim your brand</Button>
        <EmailText>
          This link expires in 7 days. If you did not submit this brand, you can safely ignore this email.
        </EmailText>
        <EmailText>Formoria - Made in Taiwan Brand Directory</EmailText>
      </Layout>
    )
  }

  return (
    <Layout previewText={`認領您在 Formoria 的品牌頁面 - ${escapedBrandName}`}>
      <EmailHeading as="h2">恭喜！您的品牌已通過審核。</EmailHeading>
      <EmailText>
        <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> 現已刊登於 Formoria。
      </EmailText>
      <EmailText>身為品牌擁有者，您可以認領您的品牌頁面，直接管理和編輯您的品牌資訊。</EmailText>
      <Button href={escapedClaimUrl}>認領您的品牌</Button>
      <EmailText>此連結將在 7 天後失效。如果您並未提交此品牌，可安全忽略此郵件。</EmailText>
      <EmailText>Formoria - 台灣品牌目錄</EmailText>
    </Layout>
  )
}

export async function buildClaimEmail(props: ClaimSubmittedEmailProps): Promise<EmailMessage> {
  const locale = props.locale ?? 'zh-TW'
  const brandName = escapeHtml(props.brandName)

  return {
    to: props.submitterEmail,
    from: FROM_ADDRESS,
    subject:
      locale === 'en'
        ? `Claim your brand page on Formoria — ${brandName}`
        : `認領您在 Formoria 的品牌頁面 — ${brandName}`,
    html: await render(<ClaimSubmittedEmail {...props} siteUrl={props.siteUrl ?? SITE_URL} />),
  }
}
