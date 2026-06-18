import * as React from 'react'
import { Body, Container, Head, Html, Preview } from '@react-email/components'
import { Header } from '@emails/components/header'
import { Footer } from '@emails/components/footer'
import { BG_WARM_WHITE, FONT_STACK } from '@emails/styles'

type LayoutProps = {
  children: React.ReactNode
  previewText: string
  unsubscribeUrl?: string
}

export function Layout({
  children,
  previewText,
  unsubscribeUrl,
}: LayoutProps) {
  return (
    <Html>
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
  backgroundColor: BG_WARM_WHITE,
  fontFamily: FONT_STACK,
  margin: '0',
  padding: '0',
}

const container = {
  backgroundColor: BG_WARM_WHITE,
  margin: '0 auto',
  maxWidth: '600px',
  padding: '32px 24px',
  width: '600px',
}
