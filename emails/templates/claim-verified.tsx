import { Link } from '@react-email/components'
import { render } from '@react-email/render'
import { Layout } from '@emails/components/layout'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Button } from '@emails/components/button'
import { FROM_ADDRESS, SITE_URL, TEXT_SECONDARY } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'

type Locale = 'zh-TW' | 'en'

type ClaimVerifiedEmailProps = {
  recipientEmail: string
  brandName: string
  verifyUrl: string
  siteUrl?: string
  locale?: Locale
}

export default function ClaimVerifiedEmail({
  brandName,
  verifyUrl,
  siteUrl = SITE_URL,
  locale = 'zh-TW',
}: ClaimVerifiedEmailProps) {
  const escapedBrandName = escapeHtml(brandName)
  const escapedVerifyUrl = escapeHtml(verifyUrl)
  const escapedSiteUrl = escapeHtml(siteUrl)

  if (locale === 'en') {
    return (
      <Layout previewText="Verify your claim email - Formoria">
        <EmailHeading as="h2">Verify your claim email</EmailHeading>
        <EmailText>
          You requested to claim <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> on Formoria.
        </EmailText>
        <EmailText>Confirm that you control this email address by clicking the button below:</EmailText>
        <Button href={escapedVerifyUrl}>Verify email</Button>
        <EmailText>If the button does not work, open this link:</EmailText>
        <EmailText>
          <Link href={escapedVerifyUrl}>{escapedVerifyUrl}</Link>
        </EmailText>
        <EmailText>
          This link expires in 7 days. If you did not request this claim, you can safely ignore this email.
        </EmailText>
        <EmailText>Formoria - Made in Taiwan Brand Directory</EmailText>
        <EmailText>
          <Link href={escapedSiteUrl} style={smallLink}>
            {escapedSiteUrl}
          </Link>
        </EmailText>
      </Layout>
    )
  }

  return (
    <Layout previewText="驗證您的認領信箱 - Formoria">
      <EmailHeading as="h2">驗證您的認領信箱</EmailHeading>
      <EmailText>
        您已申請認領 Formoria 上的 <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} />。
      </EmailText>
      <EmailText>請點擊下方按鈕，確認您可控制此 Email 地址：</EmailText>
      <Button href={escapedVerifyUrl}>驗證信箱</Button>
      <EmailText>若按鈕無法使用，請開啟此連結：</EmailText>
      <EmailText>
        <Link href={escapedVerifyUrl}>{escapedVerifyUrl}</Link>
      </EmailText>
      <EmailText>此連結將在 7 天後失效。如果您並未提出此認領申請，可安全忽略此郵件。</EmailText>
      <EmailText>Formoria - 台灣品牌目錄</EmailText>
      <EmailText>
        <Link href={escapedSiteUrl} style={smallLink}>
          {escapedSiteUrl}
        </Link>
      </EmailText>
    </Layout>
  )
}

export async function buildClaimEmailVerificationEmail(
  props: ClaimVerifiedEmailProps
): Promise<EmailMessage> {
  const locale = props.locale ?? 'zh-TW'

  return {
    to: props.recipientEmail,
    from: FROM_ADDRESS,
    subject: locale === 'en' ? 'Verify your claim email — Formoria' : '驗證您的認領信箱 — Formoria',
    html: await render(<ClaimVerifiedEmail {...props} siteUrl={props.siteUrl ?? SITE_URL} />),
  }
}

const smallLink = {
  color: TEXT_SECONDARY,
  fontSize: '12px',
}
