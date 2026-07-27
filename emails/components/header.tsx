import { Text } from '@react-email/components'
import { FONT_STACK, INK } from '@emails/styles'

export function Header() {
  return <Text style={wordmark}>Formoria</Text>
}

const wordmark = {
  color: INK,
  fontFamily: FONT_STACK,
  fontSize: '28px',
  fontWeight: '700',
  letterSpacing: '0',
  lineHeight: '36px',
  margin: '0',
  padding: '24px 0 32px',
  textAlign: 'center' as const,
}
