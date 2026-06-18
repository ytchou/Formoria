import * as React from 'react'
import { Text } from '@react-email/components'
import { FONT_STACK, TEXT_PRIMARY } from '@emails/styles'

type EmailTextProps = {
  children: React.ReactNode
}

export function EmailText({ children }: EmailTextProps) {
  return <Text style={text}>{children}</Text>
}

const text = {
  color: TEXT_PRIMARY,
  fontFamily: FONT_STACK,
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 16px',
}
