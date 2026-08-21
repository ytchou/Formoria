import * as React from 'react'
import { Body, Container, Head, Html, Preview } from '@react-email/components'
import { Header } from '@emails/components/header'
import { Footer } from '@emails/components/footer'
import {
  FONT_STACK,
  GROUND,
  INK,
  LINE_HEIGHT_BODY,
  SPACE_GUTTER,
  SPACE_SECTION,
  SPACE_STACK,
} from '@emails/styles'

type LayoutProps = {
  children: React.ReactNode
  previewText: string
  unsubscribeUrl?: string
  /**
   * `@react-email/html` defaults to `lang="en"`, so every zh-TW email shipped
   * declaring itself English and screen readers read Mandarin with an English
   * voice. zh-TW is the canonical locale, so it is the default here and the
   * English branches opt out.
   */
  lang?: 'zh-TW' | 'en'
}

export function Layout({
  children,
  previewText,
  unsubscribeUrl,
  lang = 'zh-TW',
}: LayoutProps) {
  return (
    <Html lang={lang}>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Header />
          {children}
          <Footer unsubscribeUrl={unsubscribeUrl} />
        </Container>
      </Body>
    </Html>
  )
}

const body = {
  backgroundColor: GROUND,
  color: INK,
  fontFamily: FONT_STACK,
  lineHeight: LINE_HEIGHT_BODY,
  margin: '0',
  padding: '0',
}

/**
 * The column is the paper, so it takes the ground rather than a white card on
 * a tinted page. v1 painted both the same value and called one of them a card;
 * v2 has one material here and separates with hairlines instead.
 */
const container = {
  backgroundColor: GROUND,
  margin: '0 auto',
  maxWidth: '600px',
  padding: `${SPACE_STACK} ${SPACE_GUTTER} ${SPACE_SECTION}`,
  width: '600px',
}
