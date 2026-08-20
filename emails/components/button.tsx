import * as React from 'react'
import { Button as ReactEmailButton } from '@react-email/components'
import {
  ACCENT,
  FONT_STACK,
  ON_ACCENT,
  RADIUS_CONTROL,
} from '@emails/styles'

type ButtonProps = {
  href: string
  children: React.ReactNode
}

export function Button({ href, children }: ButtonProps) {
  return (
    <ReactEmailButton href={href} style={button}>
      {children}
    </ReactEmailButton>
  )
}

/**
 * The v2 primary button: accent fill, ground label, 4px paper edge, 44px tall.
 * 12 + 20 + 12 is the touch minimum, which matters more in mail than on the
 * web — most opens are on a phone and there is no hover to recover from a miss.
 */
const button = {
  backgroundColor: ACCENT,
  borderRadius: RADIUS_CONTROL,
  color: ON_ACCENT,
  display: 'inline-block',
  fontFamily: FONT_STACK,
  fontSize: '15px',
  fontWeight: '600',
  lineHeight: '20px',
  padding: '12px 20px',
  textDecoration: 'none',
}
