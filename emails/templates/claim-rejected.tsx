import { Link } from '@react-email/components'
import { render } from '@react-email/render'
import { Layout } from '@emails/components/layout'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'

type Locale = 'zh-TW' | 'en'

type ClaimRejectedEmailProps = {
  ownerEmail: string
  brandName: string
  reviewerNotes: string
  siteUrl?: string
  locale?: Locale
}

export default function ClaimRejectedEmail({
  brandName,
  reviewerNotes,
  siteUrl = SITE_URL,
  locale = 'zh-TW',
}: ClaimRejectedEmailProps) {
  const escapedBrandName = escapeHtml(brandName)
  const escapedSiteUrl = escapeHtml(siteUrl)
  const escapedReviewerNotes = escapeHtml(reviewerNotes.trim())

  if (locale === 'en') {
    return (
      <Layout previewText={`Your brand claim for ${escapedBrandName} was not approved`}>
        <EmailHeading as="h2">Your brand claim was not approved</EmailHeading>
        <EmailText>
          Thank you for submitting a claim for <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} />.
        </EmailText>
        <EmailText>After review, we are unable to approve this claim at this time.</EmailText>
        <ReviewerNotes label="Reviewer notes" notes={escapedReviewerNotes} />
        <EmailText>If you have more supporting information, please review your brand details on Formoria.</EmailText>
        <EmailText>
          <Link href={escapedSiteUrl}>{escapedSiteUrl}</Link>
        </EmailText>
        <EmailText>Formoria - Made in Taiwan Brand Directory</EmailText>
      </Layout>
    )
  }

  return (
    <Layout previewText={`您的品牌認領申請「${escapedBrandName}」未通過審核`}>
      <EmailHeading as="h2">您的品牌認領申請未通過審核</EmailHeading>
      <EmailText>
        感謝您提交 <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> 的品牌認領申請。
      </EmailText>
      <EmailText>經審核後，我們目前無法批准此次申請。</EmailText>
      <ReviewerNotes label="審核意見" notes={escapedReviewerNotes} />
      <EmailText>若您有補充資料，可前往 Formoria 重新確認品牌資訊。</EmailText>
      <EmailText>
        <Link href={escapedSiteUrl}>{escapedSiteUrl}</Link>
      </EmailText>
      <EmailText>Formoria - 台灣品牌目錄</EmailText>
    </Layout>
  )
}

export async function buildClaimRejectedEmail(props: ClaimRejectedEmailProps): Promise<EmailMessage> {
  const locale = props.locale ?? 'zh-TW'
  const brandName = escapeHtml(props.brandName)

  return {
    to: props.ownerEmail,
    from: FROM_ADDRESS,
    subject:
      locale === 'en'
        ? `Your brand claim for "${brandName}" was not approved — Formoria`
        : `您的品牌認領申請「${brandName}」未通過審核 — Formoria`,
    html: await render(<ClaimRejectedEmail {...props} siteUrl={props.siteUrl ?? SITE_URL} />),
  }
}

function ReviewerNotes({ label, notes }: { label: string; notes: string }) {
  if (notes === '') {
    return null
  }

  return (
    <>
      <EmailText>
        <strong>{label}:</strong>
      </EmailText>
      <blockquote style={blockquote} dangerouslySetInnerHTML={{ __html: notes }} />
    </>
  )
}

const blockquote = {
  borderLeft: '3px solid #d1d5db',
  color: '#374151',
  margin: '0 0 16px',
  paddingLeft: '12px',
}
