import { Hr } from '@react-email/components'
import { BORDER } from '@emails/styles'

export function EmailDivider() {
  return <Hr style={divider} />
}

const divider = {
  borderColor: BORDER,
  margin: '24px 0',
}
