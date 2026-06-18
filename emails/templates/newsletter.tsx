import * as React from 'react'
import { render } from '@react-email/render'
import { Section } from '@react-email/components'
import { BrandCard } from '@emails/components/brand-card'
import { EmailDivider, EmailHeading, EmailText, Layout } from '@emails/components/'
import { FROM_ADDRESS, SITE_URL } from '@emails/styles'
import type { EmailMessage } from '@emails/types'
import { listUnsubscribeHeaders } from '@emails/utils'

export type NewsletterBrand = {
  name: string
  slug: string
  imageUrl: string
  blurb: string
  ctaUrl: string
}

type NewsletterEmailProps = {
  to: string
  edition: string
  brands: NewsletterBrand[]
  unsubscribeToken: string
}

function unsubscribeUrl(token: string) {
  return `${SITE_URL}/api/unsubscribe?token=${token}`
}

export function NewsletterEmail({
  edition,
  brands,
  unsubscribeToken,
}: NewsletterEmailProps) {
  return (
    <Layout
      previewText={`Formoria 品牌精選 — ${edition}`}
      unsubscribeUrl={unsubscribeUrl(unsubscribeToken)}
    >
      <Section style={intro}>
        <EmailHeading>Formoria 品牌精選 — {edition}</EmailHeading>
        <EmailText>
          探索來自台灣的設計、工藝與生活品牌。Curated by Formoria.
        </EmailText>
      </Section>

      {brands.map((brand, index) => (
        <React.Fragment key={brand.slug}>
          {index > 0 ? <EmailDivider /> : null}
          <BrandCard
            name={brand.name}
            imageUrl={brand.imageUrl}
            blurb={brand.blurb}
            ctaUrl={brand.ctaUrl}
          />
        </React.Fragment>
      ))}
    </Layout>
  )
}

export async function buildNewsletterEmail(
  params: NewsletterEmailProps,
): Promise<EmailMessage> {
  const html = await render(<NewsletterEmail {...params} />)

  return {
    to: params.to,
    from: FROM_ADDRESS,
    subject: `Formoria 品牌精選 — ${params.edition}`,
    html,
    replyTo: 'ops@formoria.com',
    headers: listUnsubscribeHeaders(params.unsubscribeToken),
  }
}

const intro = {
  margin: '0 0 24px',
}
