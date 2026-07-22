import { Link } from '@react-email/components'
import { render } from '@react-email/render'
import { Layout } from '@emails/components/layout'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'

type Locale = 'zh-TW' | 'en'

type DeclarationRemovedEmailProps = {
  brandName: string
  reviewerNotes: string
  locale?: Locale
}

type BuildDeclarationRemovedEmailProps = DeclarationRemovedEmailProps & {
  ownerEmail: string
}

export default function DeclarationRemovedEmail({
  brandName,
  reviewerNotes,
  locale = 'zh-TW',
}: DeclarationRemovedEmailProps) {
  const escapedBrandName = escapeHtml(brandName)
  const escapedReviewerNotes = escapeHtml(reviewerNotes.trim())
  const dashboardUrl = `${SITE_URL}/dashboard`

  if (locale === 'en') {
    return (
      <Layout previewText={`MIT declaration removed for ${escapedBrandName}`}>
        <EmailHeading as="h2">MIT declaration removed</EmailHeading>
        <EmailText>
          After reviewing community-submitted origin evidence, we removed the
          Made in Taiwan declaration for{' '}
          <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} />.
        </EmailText>
        <ReviewerNotes label="Reviewer notes:" notes={escapedReviewerNotes} />
        <EmailText>
          Visit the MIT status card in your brand dashboard to review the
          current status.
        </EmailText>
        <EmailText>
          You can re-declare after addressing the evidence, or pursue Tier 1
          registry verification with valid MIT certification.
        </EmailText>
        <EmailText>
          <Link href={dashboardUrl}>Open the MIT status card</Link>
        </EmailText>
        <EmailText>Formoria - Made in Taiwan Brand Directory</EmailText>
      </Layout>
    )
  }

  return (
    <Layout previewText={`「${escapedBrandName}」的台灣製造聲明已移除`}>
      <EmailHeading as="h2">台灣製造聲明已移除</EmailHeading>
      <EmailText>
        經社群提交的產地證據審核後，我們已移除{' '}
        <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} />{' '}
        的台灣製造聲明。
      </EmailText>
      <ReviewerNotes label="審核意見：" notes={escapedReviewerNotes} />
      <EmailText>請前往品牌主後台的台灣製造狀態卡查看目前狀態。</EmailText>
      <EmailText>
        您可以在處理相關證據後重新聲明，或提供有效的 MIT
        認證，申請第 1 級登錄驗證。
      </EmailText>
      <EmailText>
        <Link href={dashboardUrl}>前往台灣製造狀態卡</Link>
      </EmailText>
      <EmailText>Formoria - 台灣品牌目錄</EmailText>
    </Layout>
  )
}

export async function buildDeclarationRemovedEmail(
  props: BuildDeclarationRemovedEmailProps,
): Promise<EmailMessage> {
  const locale = props.locale ?? 'zh-TW'
  const brandName = escapeHtml(props.brandName)

  return {
    to: props.ownerEmail,
    from: FROM_ADDRESS,
    subject:
      locale === 'en'
        ? `MIT declaration removed for "${brandName}" — Formoria`
        : `「${brandName}」的台灣製造聲明已移除 — Formoria`,
    html: await render(<DeclarationRemovedEmail {...props} />),
  }
}

function ReviewerNotes({ label, notes }: { label: string; notes: string }) {
  return (
    <EmailText>
      <strong>{label}</strong>{' '}
      <span dangerouslySetInnerHTML={{ __html: notes }} />
    </EmailText>
  )
}
