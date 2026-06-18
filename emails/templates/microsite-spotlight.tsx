import { render } from '@react-email/render'
import { Link } from '@react-email/components'
import { Button } from '@emails/components/button'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Layout } from '@emails/components/layout'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { listUnsubscribeHeaders } from '@emails/utils'

type MicrositeSpotlightEmailProps = {
  to: string
  brandName: string
  brandSlug: string
  unsubscribeToken: string
}

export async function buildMicrositeSpotlightEmail({
  to,
  brandName,
  brandSlug,
  unsubscribeToken,
}: MicrositeSpotlightEmailProps): Promise<EmailMessage> {
  const micrositeUrl = `${SITE_URL}/brands/${brandSlug}`
  const unsubscribeUrl = `${SITE_URL}/api/unsubscribe?token=${unsubscribeToken}`
  const html = await render(
    <Layout
      previewText={`${brandName} 的 Formoria 品牌頁已可分享。`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <EmailHeading>{brandName} 的品牌頁已就緒</EmailHeading>
      <EmailText>
        您可以分享這個 Formoria 品牌頁，讓買家更快認識您的品牌、產品與聯絡資訊。
      </EmailText>
      <Button href={micrositeUrl}>查看品牌頁</Button>
      <EmailText>
        分享連結：
        <Link href={micrositeUrl} style={link}>
          {micrositeUrl}
        </Link>
      </EmailText>
    </Layout>
  )

  return {
    to,
    from: FROM_ADDRESS,
    subject: `${brandName} 的品牌頁已就緒 — Formoria`,
    html,
    headers: listUnsubscribeHeaders(unsubscribeToken),
  }
}

const link = {
  color: '#2563eb',
  textDecoration: 'underline',
}
