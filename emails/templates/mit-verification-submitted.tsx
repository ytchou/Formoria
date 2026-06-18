import { render } from '@react-email/render'
import { Layout } from '@emails/components/layout'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Button } from '@emails/components/button'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'

type MitVerificationSubmittedEmailProps = {
  to: string
  brandName: string
}

export default function MitVerificationSubmittedEmail({ brandName }: MitVerificationSubmittedEmailProps) {
  const escapedBrandName = escapeHtml(brandName)

  return (
    <Layout previewText={`MIT verification submitted - ${escapedBrandName}`}>
      <EmailHeading as="h2">MIT 驗證已收到</EmailHeading>
      <EmailText>
        我們已收到 <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> 的 MIT 驗證申請，團隊將開始審核。
      </EmailText>
      <EmailText>
        We received your MIT verification submission for{' '}
        <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> and will review it shortly.
      </EmailText>
      <Button href={SITE_URL}>View Formoria</Button>
      <EmailText>Formoria - 台灣品牌目錄</EmailText>
    </Layout>
  )
}

export async function buildMitVerificationSubmittedEmail(
  props: MitVerificationSubmittedEmailProps
): Promise<EmailMessage> {
  const brandName = escapeHtml(props.brandName)

  return {
    to: props.to,
    from: FROM_ADDRESS,
    subject: `MIT verification submitted — ${brandName}`,
    replyTo: 'ops@formoria.com',
    html: await render(<MitVerificationSubmittedEmail {...props} />),
  }
}
