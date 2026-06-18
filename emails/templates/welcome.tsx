import { render } from '@react-email/render'
import { Link } from '@react-email/components'
import { Button } from '@emails/components/button'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Layout } from '@emails/components/layout'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { listUnsubscribeHeaders } from '@emails/utils'

type WelcomeEmailProps = {
  to: string
  brandName: string
  brandSlug: string
  unsubscribeToken: string
}

export async function buildWelcomeEmail({
  to,
  brandName,
  brandSlug,
  unsubscribeToken,
}: WelcomeEmailProps): Promise<EmailMessage> {
  const dashboardUrl = `${SITE_URL}/dashboard`
  const micrositeUrl = `${SITE_URL}/brands/${brandSlug}`
  const unsubscribeUrl = `${SITE_URL}/api/unsubscribe?token=${unsubscribeToken}`
  const html = await render(
    <Layout
      previewText={`歡迎加入 Formoria，${brandName} 的品牌工作區已準備好。`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <EmailHeading>歡迎，{brandName}</EmailHeading>
      <EmailText>
        您的品牌工作區已準備好。接下來可以回到後台補齊品牌資料，讓買家更快了解您的產品、故事與聯絡方式。
      </EmailText>
      <Button href={dashboardUrl}>前往品牌後台</Button>
      <EmailText>
        品牌頁面也已建立：
        <Link href={micrositeUrl} style={link}>
          {micrositeUrl}
        </Link>
      </EmailText>
    </Layout>
  )

  return {
    to,
    from: FROM_ADDRESS,
    subject: `歡迎加入 Formoria — ${brandName}`,
    html,
    headers: listUnsubscribeHeaders(unsubscribeToken),
  }
}

const link = {
  color: '#2563eb',
  textDecoration: 'underline',
}
