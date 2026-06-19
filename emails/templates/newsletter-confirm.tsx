import { Link, Section, Text } from '@react-email/components'
import { render } from '@react-email/render'
import { Button, EmailDivider, EmailHeading, EmailText, Layout } from '@emails/components/'
import {
  BG_WHITE,
  BORDER,
  FONT_STACK,
  FROM_ADDRESS,
  SITE_URL,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from '@emails/styles'
import type { EmailMessage } from '@emails/types'

type NewsletterConfirmEmailProps = {
  to: string
  confirmToken: string
  interests: string[]
}

const INTEREST_LABELS: Record<string, string> = {
  'brand-stories': '品牌故事 Brand Stories',
  'new-brands': '新品牌 New Brands',
  'curated-picks': '選物推薦 Curated Picks',
  'mit-trends': '台灣製造趨勢 MIT Trends',
}

function confirmUrl(token: string) {
  return `${SITE_URL}/api/newsletter/confirm?token=${encodeURIComponent(token)}`
}

function unsubscribeUrl(token: string) {
  return `${SITE_URL}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`
}

function listUnsubscribeHeaders(token: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl(token)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

export function NewsletterConfirmEmail({
  confirmToken,
  interests,
}: NewsletterConfirmEmailProps) {
  const confirmationUrl = confirmUrl(confirmToken)
  const unsubscribeLink = unsubscribeUrl(confirmToken)
  const selectedInterests = interests.map((interest) => INTEREST_LABELS[interest] ?? interest)

  return (
    <Layout
      previewText="確認您的 Formoria 訂閱 — Confirm your Formoria subscription"
      unsubscribeUrl={unsubscribeLink}
    >
      <EmailHeading>確認訂閱 Confirm your subscription</EmailHeading>
      <EmailText>
        感謝您訂閱 Formoria 電子報。請確認訂閱，以接收台灣品牌故事、新品牌與精選趨勢。
      </EmailText>
      <EmailText>
        Thank you for subscribing to Formoria. Confirm your subscription to receive stories,
        new brand discoveries, and curated Made in Taiwan trends.
      </EmailText>

      {selectedInterests.length > 0 ? (
        <Section style={interestsSection}>
          <Text style={interestIntro}>您選擇的主題 / Selected interests</Text>
          {selectedInterests.map((interest) => (
            <Text key={interest} style={interestBadge}>
              {interest}
            </Text>
          ))}
        </Section>
      ) : null}

      <Button href={confirmationUrl}>確認訂閱 Confirm Subscription</Button>

      <EmailDivider />
      <EmailText>
        若按鈕無法使用，請開啟此連結 / If the button does not work, open this link:
      </EmailText>
      <EmailText>
        <Link href={confirmationUrl} style={link}>
          {confirmationUrl}
        </Link>
      </EmailText>
      <EmailText>
        若您沒有訂閱 Formoria 電子報，可使用頁尾連結取消訂閱。If you did not request
        this subscription, you can unsubscribe from the footer link.
      </EmailText>
    </Layout>
  )
}

export async function buildNewsletterConfirmEmail(
  params: NewsletterConfirmEmailProps
): Promise<EmailMessage> {
  const html = await render(<NewsletterConfirmEmail {...params} />)

  return {
    to: params.to,
    from: FROM_ADDRESS,
    subject: '確認您的 Formoria 訂閱 — Confirm your Formoria subscription',
    html,
    replyTo: 'ops@formoria.com',
    headers: listUnsubscribeHeaders(params.confirmToken),
  }
}

export default NewsletterConfirmEmail

const interestsSection = {
  backgroundColor: BG_WHITE,
  border: `1px solid ${BORDER}`,
  borderRadius: '8px',
  margin: '0 0 24px',
  padding: '16px',
}

const interestIntro = {
  color: TEXT_SECONDARY,
  fontFamily: FONT_STACK,
  fontSize: '13px',
  lineHeight: '20px',
  margin: '0 0 10px',
}

const interestBadge = {
  border: `1px solid ${BORDER}`,
  borderRadius: '999px',
  color: TEXT_PRIMARY,
  display: 'inline-block',
  fontFamily: FONT_STACK,
  fontSize: '14px',
  lineHeight: '20px',
  margin: '0 8px 8px 0',
  padding: '6px 10px',
}

const link = {
  color: '#2563eb',
  textDecoration: 'underline',
  wordBreak: 'break-all' as const,
}
