import { render } from '@react-email/render'
import { Button } from '@emails/components/button'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Layout } from '@emails/components/layout'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { listUnsubscribeHeaders } from '@emails/utils'

type ReEngagementEmailProps = {
  to: string
  brandName: string
  brandSlug: string
  unsubscribeToken: string
}

export async function buildReEngagementEmail({
  to,
  brandName,
  brandSlug,
  unsubscribeToken,
}: ReEngagementEmailProps): Promise<EmailMessage> {
  const dashboardUrl = `${SITE_URL}/dashboard?tab=${brandSlug}`
  const unsubscribeUrl = `${SITE_URL}/api/unsubscribe?token=${unsubscribeToken}`
  const html = await render(
    <Layout
      previewText={`回到 Formoria 完善 ${brandName} 的品牌頁。`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <EmailHeading>繼續完善 {brandName}</EmailHeading>
      <EmailText>
        完成品牌資料後，買家能更清楚了解您的產品、品牌故事與合作方式。只需要幾分鐘，就能讓品牌頁更完整。
      </EmailText>
      <Button href={dashboardUrl}>回到品牌後台</Button>
    </Layout>
  )

  return {
    to,
    from: FROM_ADDRESS,
    subject: `回來完善 ${brandName} 的品牌頁 — Formoria`,
    html,
    headers: listUnsubscribeHeaders(unsubscribeToken),
  }
}
