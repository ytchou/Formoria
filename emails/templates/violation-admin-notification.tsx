import { render } from '@react-email/render'
import { Layout } from '@emails/components/layout'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Button } from '@emails/components/button'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'

type ViolationAdminNotificationProps = {
  brandName: string
  ownerEmail: string
  violations: Array<{ field: string; rule: string; userMessage: string }>
  adminEmail?: string
  siteUrl?: string
}

export default function ViolationAdminNotificationEmail({
  brandName,
  ownerEmail,
  violations,
  siteUrl = SITE_URL,
}: ViolationAdminNotificationProps) {
  const escapedBrandName = escapeHtml(brandName)
  const escapedOwnerEmail = escapeHtml(ownerEmail)
  const escapedViolations = violations.map((violation) => ({
    field: escapeHtml(violation.field),
    rule: escapeHtml(violation.rule),
    userMessage: escapeHtml(violation.userMessage),
  }))

  return (
    <Layout previewText={`Content violation detected for ${escapedBrandName}`}>
      <EmailHeading as="h2">Content Violation Detected</EmailHeading>
      <EmailText>
        An edit by <span dangerouslySetInnerHTML={{ __html: escapedOwnerEmail }} /> for brand &quot;
        <span dangerouslySetInnerHTML={{ __html: escapedBrandName }} />&quot; was auto-rejected.
      </EmailText>
      <ul>
        {escapedViolations.map((violation, index) => (
          <li key={index}>
            <EmailText>
              <strong>Field:</strong> <span dangerouslySetInnerHTML={{ __html: violation.field }} /> |{' '}
              <strong>Rule:</strong> <span dangerouslySetInnerHTML={{ __html: violation.rule }} /> |{' '}
              <strong>Message:</strong> <span dangerouslySetInnerHTML={{ __html: violation.userMessage }} />
            </EmailText>
          </li>
        ))}
      </ul>
      <Button href={`${siteUrl}/admin/moderation`}>Review moderation</Button>
    </Layout>
  )
}

export async function buildViolationAdminNotificationEmail(
  props: ViolationAdminNotificationProps,
): Promise<EmailMessage> {
  const brandName = escapeHtml(props.brandName)

  return {
    to: props.adminEmail ?? (process.env.ADMIN_EMAIL || 'admin@formoria.com'),
    from: FROM_ADDRESS,
    subject: `[Moderation] Auto-rejected edit: ${brandName} — Formoria`,
    html: await render(<ViolationAdminNotificationEmail {...props} siteUrl={props.siteUrl ?? SITE_URL} />),
  }
}
