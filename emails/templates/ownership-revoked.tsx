import { Link } from '@react-email/components'
import { render } from '@react-email/render'
import { Layout } from '@emails/components/layout'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { FROM_ADDRESS } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'
import { CONTACT_EMAILS } from '@/lib/constants'

type OwnershipRevokedEmailProps = {
  brandName: string
  reason: string
}

type BuildOwnershipRevokedEmailProps = OwnershipRevokedEmailProps & {
  ownerEmail: string
}

export default function OwnershipRevokedEmail({
  brandName,
  reason,
}: OwnershipRevokedEmailProps) {
  const escapedBrandName = escapeHtml(brandName)
  const escapedReason = escapeHtml(reason.trim())

  return (
    <Layout previewText={`「${escapedBrandName}」品牌管理權限已移除`}>
      <EmailHeading as="h2">品牌管理權限已移除</EmailHeading>
      <EmailText>
        我們通知您，您對{' '}
        <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} />{' '}
        的品牌管理權限已被移除。
      </EmailText>
      <Reason label="原因：" reason={escapedReason} />
      <EmailText>
        如對此決定有疑問，請聯絡 Formoria 支援團隊：
        <Link href={`mailto:${CONTACT_EMAILS.contact}`}>
          {CONTACT_EMAILS.contact}
        </Link>
      </EmailText>

      <EmailHeading as="h2">Brand management access removed</EmailHeading>
      <EmailText>
        This is to notify you that your management access for{' '}
        <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> has
        been removed.
      </EmailText>
      <Reason label="Reason:" reason={escapedReason} />
      <EmailText>
        If you have questions about this decision, contact Formoria support at{' '}
        <Link href={`mailto:${CONTACT_EMAILS.contact}`}>
          {CONTACT_EMAILS.contact}
        </Link>
        .
      </EmailText>
      <EmailText>
        Formoria - 台灣品牌目錄 / Made in Taiwan Brand Directory
      </EmailText>
    </Layout>
  )
}

export async function buildOwnershipRevokedEmail(
  props: BuildOwnershipRevokedEmailProps,
): Promise<EmailMessage> {
  const brandName = escapeHtml(props.brandName)

  return {
    to: props.ownerEmail,
    from: FROM_ADDRESS,
    subject: `「${brandName}」品牌管理權限已移除 / Brand management access removed — Formoria`,
    html: await render(
      <OwnershipRevokedEmail
        brandName={props.brandName}
        reason={props.reason}
      />,
    ),
  }
}

function Reason({ label, reason }: { label: string; reason: string }) {
  return (
    <EmailText>
      <strong>{label}</strong>{' '}
      <span dangerouslySetInnerHTML={{ __html: reason }} />
    </EmailText>
  )
}
