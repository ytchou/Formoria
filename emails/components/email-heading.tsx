import * as React from 'react'
import { Heading } from '@react-email/components'
import {
  FONT_SIZE_HEADING,
  FONT_SIZE_TITLE,
  FONT_STACK,
  INK,
  LINE_HEIGHT_HEADING,
  LINE_HEIGHT_TITLE,
  SPACE_GUTTER,
} from '@emails/styles'

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
  color: INK,
  fontFamily: FONT_STACK,
  fontWeight: '700',
  letterSpacing: '-0.01em',
  margin: `0 0 ${SPACE_GUTTER}`,
}

/** The v2 page-title step, at the sans equivalent of 明體 26. */
const h1 = {
  ...baseHeading,
  fontSize: FONT_SIZE_TITLE,
  lineHeight: LINE_HEIGHT_TITLE,
}

/** The v2 card-title step. */
const h2 = {
  ...baseHeading,
  fontSize: FONT_SIZE_HEADING,
  lineHeight: LINE_HEIGHT_HEADING,
}
