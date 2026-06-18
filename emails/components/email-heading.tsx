import * as React from 'react'
import { Heading } from '@react-email/components'
import { FONT_STACK, TEXT_PRIMARY } from '@emails/styles'

type EmailHeadingProps = {
  children: React.ReactNode
  as?: 'h1' | 'h2'
}

export function EmailHeading({ children, as = 'h1' }: EmailHeadingProps) {
  return (
    <Heading as={as} style={as === 'h1' ? h1 : h2}>
      {children}
    </Heading>
  )
}

const baseHeading = {
  color: TEXT_PRIMARY,
  fontFamily: FONT_STACK,
  fontWeight: '700',
  letterSpacing: '0',
  margin: '0 0 16px',
}

const h1 = {
  ...baseHeading,
  fontSize: '28px',
  lineHeight: '36px',
}

const h2 = {
  ...baseHeading,
  fontSize: '22px',
  lineHeight: '30px',
}
