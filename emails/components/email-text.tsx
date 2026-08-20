import * as React from 'react'
import { Text } from '@react-email/components'
import {
  FONT_SIZE_BODY,
  FONT_STACK,
  INK_SOFT,
  LINE_HEIGHT_BODY,
  SPACE_GUTTER,
} from '@emails/styles'

type EmailTextProps = {
  children: React.ReactNode
}

/**
 * Body prose takes `ink-soft`, not `ink`. v1 set every paragraph at full ink,
 * which flattened the message: the heading and the body arrived at the same
 * weight and the reader had nothing to skim by.
 */
export function EmailText({ children }: EmailTextProps) {
  return <Text style={text}>{children}</Text>
}

const text = {
  color: INK_SOFT,
  fontFamily: FONT_STACK,
  fontSize: FONT_SIZE_BODY,
  lineHeight: LINE_HEIGHT_BODY,
  margin: `0 0 ${SPACE_GUTTER}`,
}
