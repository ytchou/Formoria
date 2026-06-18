import { Hr, Link, Text } from '@react-email/components'
import {
  BORDER,
  FONT_STACK,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from '@emails/styles'

type FooterProps = {
  unsubscribeUrl?: string
}

export function Footer({ unsubscribeUrl }: FooterProps) {
  return (
    <>
      <Hr style={divider} />
      <Text style={tagline}>Made in Taiwan 🇹🇼</Text>
      <Text style={contact}>
        <Link href="mailto:ops@formoria.com" style={link}>
          ops@formoria.com
        </Link>
      </Text>
      {unsubscribeUrl ? (
        <Text style={unsubscribe}>
          <Link href={unsubscribeUrl} style={link}>
            取消訂閱
          </Link>{' '}
          / Unsubscribe
        </Text>
      ) : null}
    </>
  )
}

const divider = {
  borderColor: BORDER,
  margin: '32px 0 20px',
}

const tagline = {
  color: TEXT_PRIMARY,
  fontFamily: FONT_STACK,
  fontSize: '14px',
  lineHeight: '22px',
  margin: '0 0 8px',
  textAlign: 'center' as const,
}

const contact = {
  color: TEXT_SECONDARY,
  fontFamily: FONT_STACK,
  fontSize: '13px',
  lineHeight: '20px',
  margin: '0 0 8px',
  textAlign: 'center' as const,
}

const unsubscribe = {
  color: TEXT_SECONDARY,
  fontFamily: FONT_STACK,
  fontSize: '12px',
  lineHeight: '18px',
  margin: '0',
  textAlign: 'center' as const,
}

const link = {
  color: TEXT_SECONDARY,
  textDecoration: 'underline',
}
