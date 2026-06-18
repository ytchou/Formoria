import { render } from '@react-email/render'
import { Layout } from '@emails/components/layout'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Button } from '@emails/components/button'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'

type MitVerificationApprovedEmailProps = {
  to: string
  brandName: string
}

export default function MitVerificationApprovedEmail({ brandName }: MitVerificationApprovedEmailProps) {
  const escapedBrandName = escapeHtml(brandName)

  return (
    <Layout previewText={`MIT verification approved - ${escapedBrandName}`}>
      <EmailHeading as="h2">MIT 品牌已驗證</EmailHeading>
      <EmailText>
        <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> 的 MIT 驗證已通過，品牌頁面將顯示已驗證標章。
      </EmailText>
      <EmailText>
        <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> is now verified and will show the verified
        badge on Formoria.
      </EmailText>
      <Button href={SITE_URL}>View Formoria</Button>
      <EmailText>Formoria - 台灣品牌目錄</EmailText>
    </Layout>
  )
}

export async function buildMitVerificationApprovedEmail(
  props: MitVerificationApprovedEmailProps
): Promise<EmailMessage> {
  const brandName = escapeHtml(props.brandName)

  return {
    to: props.to,
    from: FROM_ADDRESS,
    subject: `MIT verification approved — ${brandName}`,
    replyTo: 'ops@formoria.com',
    html: await render(<MitVerificationApprovedEmail {...props} />),
  }
}
