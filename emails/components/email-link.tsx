import * as React from 'react'
import { Link } from '@react-email/components'
import {
  ACCENT,
  FONT_SIZE_MICRO,
  FONT_STACK,
  INK_MUTED,
} from '@emails/styles'

/**
 * EVERY LINK IN AN EMAIL GOES THROUGH HERE.
 *
 * `@react-email/components`' `Link` defaults to `color: #067df7` and merges the
 * caller's style after it, so an unstyled `<Link>` renders a stock blue that
 * appears in no Formoria palette. Eleven of them were shipping in live
 * transactional mail — the fix is a component, not a style object copied into
 * each template for the twelfth time.
 *
 * `accent` is the reading link. `muted` is for a URL printed as a fallback,
 * where the address is reference material rather than the thing to click.
 */
type EmailLinkProps = {
  href: string
  children: React.ReactNode
  tone?: 'accent' | 'muted'
}

export function EmailLink({ href, children, tone = 'accent' }: EmailLinkProps) {
  return (
    <Link href={href} style={tone === 'muted' ? mutedLink : accentLink}>
      {children}
    </Link>
  )
}

const base = {
  fontFamily: FONT_STACK,
  textDecoration: 'underline',
  // Several templates print a full verification URL as the button fallback.
  // Without this the column blows past 600px in clients that do not wrap.
  wordBreak: 'break-all' as const,
}

const accentLink = {
  ...base,
  color: ACCENT,
}

const mutedLink = {
  ...base,
  color: INK_MUTED,
  fontSize: FONT_SIZE_MICRO,
}
