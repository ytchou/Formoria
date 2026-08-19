import * as React from 'react'
import { Hr, Text } from '@react-email/components'
import {
  FONT_SIZE_HEADING,
  FONT_STACK,
  INK,
  LINE_HEIGHT_HEADING,
  RULE,
  SPACE_GUTTER,
  SPACE_STACK,
} from '@emails/styles'

/**
 * A left-aligned masthead over a hairline, not a centred 28px banner.
 *
 * The wordmark is chrome, not the message — v1 set it two steps larger than
 * the heading below it, so every email opened by announcing the sender twice.
 * At 21px over a rule it reads as a letterhead and the heading takes the page.
 */
export function Header() {
  return (
    <>
      <Text style={wordmark}>Formoria</Text>
      <Hr style={rule} />
    </>
  )
}

const wordmark = {
  color: INK,
  fontFamily: FONT_STACK,
  fontSize: FONT_SIZE_HEADING,
  fontWeight: '700',
  letterSpacing: '0.01em',
  lineHeight: LINE_HEIGHT_HEADING,
  margin: '0',
  padding: `0 0 ${SPACE_GUTTER}`,
  textAlign: 'left' as const,
}

/**
 * `Hr` ships a `1px solid #eaeaea` border-top shorthand and merges the caller's
 * style AFTER it, so overriding only `borderColor` leaves the stock grey in the
 * markup. Every rule in `emails/` therefore declares the whole shorthand.
 */
const rule = {
  border: 'none',
  borderTop: `1px solid ${RULE}`,
  margin: `0 0 ${SPACE_STACK}`,
  width: '100%',
}
