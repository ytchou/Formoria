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

type MicrositeSpotlightEmailProps = {
  to: string
  brandName: string
  brandSlug: string
  unsubscribeToken: string
  locale?: Locale
}

export async function buildMicrositeSpotlightEmail({
  to,
  brandName,
  brandSlug,
  unsubscribeToken,
  locale = 'zh-TW',
}: MicrositeSpotlightEmailProps): Promise<EmailMessage> {
  const micrositeUrl = `${SITE_URL}/brands/${brandSlug}`
  const unsubscribeUrl = `${SITE_URL}/api/unsubscribe?token=${unsubscribeToken}`
  const html = await render(
    locale === 'en' ? (
      <Layout
        previewText={`${brandName}'s Formoria brand page is ready to share.`}
        unsubscribeUrl={unsubscribeUrl}
      >
        <EmailHeading>{brandName}&apos;s brand page is ready</EmailHeading>
        <EmailText>
          You can share this Formoria brand page so buyers can quickly learn about your brand, products, and contact
          information.
        </EmailText>
        <Button href={micrositeUrl}>View brand page</Button>
        <EmailText>
          Share link:{' '}
          <Link href={micrositeUrl} style={link}>
            {micrositeUrl}
          </Link>
        </EmailText>
      </Layout>
    ) : (
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
  )

  return {
    to,
    from: FROM_ADDRESS,
    subject:
      locale === 'en'
        ? `Your brand page is ready for "${brandName}" — Formoria`
        : `「${brandName}」的品牌頁已就緒 — Formoria`,
    html,
    headers: listUnsubscribeHeaders(unsubscribeToken),
  }
}

const link = {
  color: '#2563eb',
  textDecoration: 'underline',
}
