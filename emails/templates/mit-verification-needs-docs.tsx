import { render } from '@react-email/render'
import { Layout } from '@emails/components/layout'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Button } from '@emails/components/button'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'

type MitVerificationNeedsDocsEmailProps = {
  to: string
  brandName: string
  notes: string
}

export default function MitVerificationNeedsDocsEmail({
  brandName,
  notes,
}: MitVerificationNeedsDocsEmailProps) {
  const escapedBrandName = escapeHtml(brandName)
  const escapedNotes = escapeHtml(notes)

  return (
    <Layout previewText={`MIT verification needs additional documents - ${escapedBrandName}`}>
      <EmailHeading as="h2">MIT 驗證需要補充文件</EmailHeading>
      <EmailText>
        <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> 的 MIT 驗證需要補充文件後才能繼續審核。
      </EmailText>
      <EmailText>
        Please provide the additional documents requested below so we can continue the MIT verification review.
      </EmailText>
      <blockquote style={blockquote} dangerouslySetInnerHTML={{ __html: escapedNotes }} />
      <Button href={SITE_URL}>View Formoria</Button>
      <EmailText>Formoria - 台灣品牌目錄</EmailText>
    </Layout>
  )
}

export async function buildMitVerificationNeedsDocsEmail(
  props: MitVerificationNeedsDocsEmailProps
): Promise<EmailMessage> {
  const brandName = escapeHtml(props.brandName)

  return {
    to: props.to,
    from: FROM_ADDRESS,
    subject: `MIT verification needs additional documents — ${brandName}`,
    replyTo: 'ops@formoria.com',
    html: await render(<MitVerificationNeedsDocsEmail {...props} />),
  }
}

const blockquote = {
  borderLeft: '3px solid #d1d5db',
  color: '#374151',
  margin: '0 0 16px',
  paddingLeft: '12px',
}
