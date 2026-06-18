import * as React from 'react'
import { Button as ReactEmailButton } from '@react-email/components'
import { FONT_STACK, TERRACOTTA } from '@emails/styles'

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

const button = {
  backgroundColor: TERRACOTTA,
  borderRadius: '6px',
  color: '#FFFFFF',
  display: 'inline-block',
  fontFamily: FONT_STACK,
  fontSize: '16px',
  fontWeight: '700',
  lineHeight: '20px',
  padding: '14px 22px',
  textDecoration: 'none',
}
