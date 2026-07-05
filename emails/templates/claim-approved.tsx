import { render } from '@react-email/render'
import { Img } from '@react-email/components'
import { Layout } from '@emails/components/layout'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { Button } from '@emails/components/button'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { escapeHtml } from '@emails/utils'
import { buildShareCardUrl } from '@/lib/growth/share-assets'

type Locale = 'zh-TW' | 'en'

type ClaimApprovedEmailProps = {
  ownerEmail: string
  brandName: string
  brandSlug: string
  siteUrl?: string
  locale?: Locale
}

export default function ClaimApprovedEmail({
  brandName,
  brandSlug,
  siteUrl = SITE_URL,
  locale = 'zh-TW',
}: ClaimApprovedEmailProps) {
  const escapedBrandName = escapeHtml(brandName)
  const dashboardUrl = `${siteUrl}/dashboard?brand=${escapeHtml(brandSlug)}`
  const cardUrl = buildShareCardUrl(siteUrl, brandSlug)
  const downloadUrl = buildShareCardUrl(siteUrl, brandSlug, { download: true })
  const badgeUrl = `${siteUrl}/dashboard?brand=${escapeHtml(brandSlug)}#badge`

  if (locale === 'en') {
    return (
      <Layout previewText={`Your brand claim for ${escapedBrandName} has been approved`}>
        <EmailHeading as="h2">Your brand claim has been approved!</EmailHeading>
        <EmailText>
          Congratulations. Your claim for <strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> has been
          approved.
        </EmailText>
        <EmailText>You can now manage your brand from the owner dashboard.</EmailText>
        <Button href={dashboardUrl}>Go to owner dashboard</Button>
        <EmailText>
          Share the news — download your brand share card and add the &ldquo;Featured on Formoria&rdquo; badge to your
          website.
        </EmailText>
        <Img src={cardUrl} width="270" height="338" alt={`${brandName} — Featured on Formoria share card`} />
        <Button href={downloadUrl}>Download share card</Button>
        <Button href={badgeUrl}>Get your badge</Button>
        <EmailText>Formoria - Made in Taiwan Brand Directory</EmailText>
      </Layout>
    )
  }

  return (
    <Layout previewText={`您的品牌認領申請「${escapedBrandName}」已通過審核`}>
      <EmailHeading as="h2">您的品牌認領申請已通過審核！</EmailHeading>
      <EmailText>
        恭喜您，<strong dangerouslySetInnerHTML={{ __html: escapedBrandName }} /> 的品牌認領申請已獲批准。
      </EmailText>
      <EmailText>您現在可以前往品牌主後台管理品牌資訊。</EmailText>
      <Button href={dashboardUrl}>前往品牌主後台</Button>
      <EmailText>分享這個好消息 — 下載品牌分享卡，並在您的網站加上「台灣製造品牌目錄」認證標章。</EmailText>
      <Img src={cardUrl} width="270" height="338" alt={`${brandName} — Formoria 品牌分享卡`} />
      <Button href={downloadUrl}>下載分享卡</Button>
      <Button href={badgeUrl}>取得認證標章</Button>
      <EmailText>Formoria - 台灣品牌目錄</EmailText>
    </Layout>
  )
}

export async function buildClaimApprovedEmail(props: ClaimApprovedEmailProps): Promise<EmailMessage> {
  const locale = props.locale ?? 'zh-TW'
  const brandName = escapeHtml(props.brandName)

  return {
    to: props.ownerEmail,
    from: FROM_ADDRESS,
    subject:
      locale === 'en'
        ? `Your brand claim for "${brandName}" has been approved — Formoria`
        : `您的品牌認領申請「${brandName}」已通過審核 — Formoria`,
    html: await render(<ClaimApprovedEmail {...props} siteUrl={props.siteUrl ?? SITE_URL} />),
  }
}
