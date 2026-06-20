import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'
import { NewsletterConfirmEmail, buildNewsletterConfirmEmail } from '../../../../emails/templates/newsletter-confirm'

describe('NewsletterConfirmEmail', () => {
  const defaultProps = {
    to: 'visitor@example.com',
    confirmToken: 'abc-123-def',
    interests: ['brand-stories', 'new-brands'],
  }

  it('renders without error (zh-TW default)', async () => {
    const html = await render(NewsletterConfirmEmail(defaultProps))
    expect(html).toContain('確認訂閱')
  })

  it('renders English when locale is en', async () => {
    const html = await render(NewsletterConfirmEmail({ ...defaultProps, locale: 'en' }))
    expect(html).toContain('Confirm')
  })

  it('includes confirm link with token', async () => {
    const html = await render(NewsletterConfirmEmail(defaultProps))
    expect(html).toContain('/api/newsletter/confirm?token=abc-123-def')
  })

  it('includes unsubscribe link', async () => {
    const html = await render(NewsletterConfirmEmail(defaultProps))
    expect(html).toContain('/api/newsletter/unsubscribe')
  })

  it('renders locale-specific content for zh-TW', async () => {
    const html = await render(NewsletterConfirmEmail(defaultProps))
    expect(html).toContain('確認訂閱')
    expect(html).toContain('品牌故事')
    expect(html).toContain('新品牌')
  })

  it('renders locale-specific content for en', async () => {
    const html = await render(NewsletterConfirmEmail({ ...defaultProps, locale: 'en' }))
    expect(html).toContain('Confirm your subscription')
    expect(html).toContain('Brand Stories')
    expect(html).toContain('New Brands')
  })

  it('buildNewsletterConfirmEmail returns valid EmailMessage', async () => {
    const msg = await buildNewsletterConfirmEmail(defaultProps)
    expect(msg.to).toBe(defaultProps.to)
    expect(msg.subject).toContain('Formoria')
    expect(msg.html).toBeTruthy()
    expect(msg.headers?.['List-Unsubscribe']).toBeTruthy()
  })
})
