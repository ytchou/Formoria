import * as React from 'react'
import { Img, Section } from '@react-email/components'
import { Button, EmailHeading, EmailText } from '@emails/components/'
import { BG_WHITE, BORDER, TEXT_SECONDARY } from '@emails/styles'

type BrandCardProps = {
  name: string
  imageUrl: string
  blurb: string
  ctaUrl: string
}

export function BrandCard({ name, imageUrl, blurb, ctaUrl }: BrandCardProps) {
  return (
    <Section style={card}>
      <Img src={imageUrl} alt={name} width="552" style={image} />
      <Section style={content}>
        <EmailHeading as="h2">{name}</EmailHeading>
        <EmailText>{blurb}</EmailText>
        <Button href={ctaUrl}>了解更多 / Learn More</Button>
      </Section>
    </Section>
  )
}

const card = {
  backgroundColor: BG_WHITE,
  border: `1px solid ${BORDER}`,
  borderRadius: '8px',
  overflow: 'hidden',
}

const image = {
  borderBottom: `1px solid ${BORDER}`,
  color: TEXT_SECONDARY,
  display: 'block',
  height: 'auto',
  maxWidth: '100%',
  width: '100%',
}

const content = {
  padding: '24px',
}
