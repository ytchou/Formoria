import { render } from '@react-email/render'
import { Text } from '@react-email/components'
import { Button } from '@emails/components/button'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Layout } from '@emails/components/layout'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { listUnsubscribeHeaders } from '@emails/utils'

type ProfileNudgeEmailProps = {
  to: string
  brandName: string
  completenessPercent: number
  missingFields: string[]
  unsubscribeToken: string
}

const FIELD_LABELS: Record<string, string> = {
  description: '品牌介紹',
  logo: 'Logo',
  social_links: '社群連結',
  founding_year: '創立年份',
  website_url: '官方網站',
}

export async function buildProfileNudgeEmail({
  to,
  brandName,
  completenessPercent,
  missingFields,
  unsubscribeToken,
}: ProfileNudgeEmailProps): Promise<EmailMessage> {
  const dashboardUrl = `${SITE_URL}/dashboard`
  const unsubscribeUrl = `${SITE_URL}/api/unsubscribe?token=${unsubscribeToken}`
  const missingLabels = missingFields.map((field) => FIELD_LABELS[field] ?? field)
  const html = await render(
    <Layout
      previewText={`${brandName} 的品牌資料目前完成 ${completenessPercent}%。`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <EmailHeading>讓 {brandName} 的品牌頁更完整</EmailHeading>
      <EmailText>
        目前品牌資料完成度為 {completenessPercent}%。補齊品牌介紹、Logo、社群連結等資訊後，買家能更快理解您的品牌。
      </EmailText>
      {missingLabels.length > 0 ? (
        <Text style={listText}>建議補齊：{missingLabels.join('、')}</Text>
      ) : null}
      <Button href={dashboardUrl}>回到品牌後台</Button>
    </Layout>
  )

  return {
    to,
    from: FROM_ADDRESS,
    subject: `完善 ${brandName} 的品牌資料 — Formoria`,
    html,
    headers: listUnsubscribeHeaders(unsubscribeToken),
  }
}

const listText = {
  color: '#1C1C1C',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 16px',
}
