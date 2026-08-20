import * as React from 'react'
import { Img, Section } from '@react-email/components'
import { Button } from '@emails/components/button'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import {
  FONT_SIZE_META,
  FONT_STACK,
  INK_MUTED,
  LINE_HEIGHT_META,
  RULE,
  SPACE_GUTTER,
  SPACE_STACK,
} from '@emails/styles'
import { truncateForMeta } from '@/lib/text/truncate-for-meta'

type BrandCardProps = {
  name: string
  imageUrl: string
  blurb: string
  ctaUrl: string
}

/**
 * A hairline-ruled band, not a bordered rounded box. v2's elevation is the
 * rule: a card in mail that draws a box, a radius and a second background is
 * three devices doing one job, and the box is the one that breaks first —
 * Outlook drops the radius and renders a hard rectangle.
 *
 * Imports the three components directly rather than through the barrel. The
 * barrel exports this file, so going back through it is a cycle.
 */
export function BrandCard({ name, imageUrl, blurb, ctaUrl }: BrandCardProps) {
  const truncatedBlurb = truncateForMeta(blurb)

  return (
    <Section style={card}>
      <Img src={imageUrl} alt={name} width="552" style={image} />
      <EmailHeading as="h2">{name}</EmailHeading>
      <EmailText>{truncatedBlurb}</EmailText>
      <Button href={ctaUrl}>了解更多 / Learn More</Button>
    </Section>
  )
}

const card = {
  border: 'none',
  borderTop: `1px solid ${RULE}`,
  borderBottom: `1px solid ${RULE}`,
  padding: `${SPACE_STACK} 0`,
}

/**
 * The alt text is styled because images are blocked by default in a great many
 * clients: when this does not load, the brand name is what sits in the gap and
 * it should read as a caption rather than as unstyled browser default.
 */
const image = {
  color: INK_MUTED,
  display: 'block',
  fontFamily: FONT_STACK,
  fontSize: FONT_SIZE_META,
  height: 'auto',
  lineHeight: LINE_HEIGHT_META,
  marginBottom: SPACE_GUTTER,
  maxWidth: '100%',
  width: '100%',
}
