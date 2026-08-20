import { Hr } from '@react-email/components'
import { RULE, SPACE_STACK } from '@emails/styles'

/**
 * The whole `border` shorthand is declared, not just `borderColor`: `Hr`
 * defaults to `border: none` plus `borderTop: 1px solid #eaeaea` and spreads
 * the caller's style after it, so a colour-only override leaves the stock grey
 * sitting in the markup underneath.
 */
export function EmailDivider() {
  return <Hr style={divider} />
}

const divider = {
  border: 'none',
  borderTop: `1px solid ${RULE}`,
  margin: `${SPACE_STACK} 0`,
  width: '100%',
}
