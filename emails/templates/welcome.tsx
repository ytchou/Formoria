import { render } from '@react-email/render'
import { Link } from '@react-email/components'
import { Button } from '@emails/components/button'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Layout } from '@emails/components/layout'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { listUnsubscribeHeaders } from '@emails/utils'

type Locale = 'zh-TW' | 'en'

type WelcomeEmailProps = {
  to: string
  brandName: string
  brandSlug: string
  unsubscribeToken: string
  locale?: Locale
}

export async function buildWelcomeEmail({
  to,
  brandName,
  brandSlug,
  unsubscribeToken,
  locale = 'zh-TW',
}: WelcomeEmailProps): Promise<EmailMessage> {
  const dashboardUrl = `${SITE_URL}/dashboard`
  const micrositeUrl = `${SITE_URL}/brands/${brandSlug}`
  const unsubscribeUrl = `${SITE_URL}/api/unsubscribe?token=${unsubscribeToken}`
  const html = await render(
    locale === 'en' ? (
      <Layout
        previewText={`Welcome to Formoria. ${brandName}'s brand workspace is ready.`}
        unsubscribeUrl={unsubscribeUrl}
      >
        <EmailHeading>Welcome, {brandName}</EmailHeading>
        <EmailText>
          Your brand workspace is ready. Head back to the dashboard to complete your brand profile so buyers can
          understand your products, story, and contact details faster.
        </EmailText>
        <Button href={dashboardUrl}>Go to brand dashboard</Button>
        <EmailText>
          Your brand page has also been created:{' '}
          <Link href={micrositeUrl} style={link}>
            {micrositeUrl}
          </Link>
        </EmailText>
      </Layout>
    ) : (
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
  )

  return {
    to,
    from: FROM_ADDRESS,
    subject:
      locale === 'en'
        ? `Welcome to "${brandName}" — Formoria`
        : `歡迎加入「${brandName}」— Formoria`,
    html,
    headers: listUnsubscribeHeaders(unsubscribeToken),
  }
}

const link = {
  color: '#2563eb',
  textDecoration: 'underline',
}
