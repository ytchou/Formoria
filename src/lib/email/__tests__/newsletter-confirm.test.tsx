import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'
import { NewsletterConfirmEmail, buildNewsletterConfirmEmail } from '../../../../emails/templates/newsletter-confirm'

describe('NewsletterConfirmEmail', () => {
  const defaultProps = {
    to: 'visitor@example.com',
    confirmToken: 'abc-123-def',
    unsubscribeToken: 'unsubscribe-456',
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
    expect(html).toContain(
      '/api/newsletter/unsubscribe?token=unsubscribe-456',
    )
    expect(html).not.toContain(
      '/api/newsletter/unsubscribe?token=abc-123-def',
    )
  })

  it('renders locale-specific content for zh-TW', async () => {
    const html = await render(NewsletterConfirmEmail(defaultProps))
    expect(html).toContain('確認訂閱')
    // Badge text, matched with its tag boundaries: the body copy also names
    // these topics, so a bare substring would pass without the badges.
    expect(html).toContain('>專題<')
    expect(html).toContain('>新收錄的品牌<')
  })

  it('renders locale-specific content for en', async () => {
    const html = await render(NewsletterConfirmEmail({ ...defaultProps, locale: 'en' }))
    expect(html).toContain('Confirm your subscription')
    expect(html).toContain('>Stories<')
    expect(html).toContain('>Newly listed brands<')
  })

  it('tells a non-subscriber to ignore the email, not to unsubscribe', async () => {
    // Double opt-in: until the link is clicked nothing is subscribed.
    const zh = await render(NewsletterConfirmEmail(defaultProps))
    expect(zh).toContain('忽略這封信就好')
    expect(zh).not.toContain('若')

    const en = await render(NewsletterConfirmEmail({ ...defaultProps, locale: 'en' }))
    expect(en).toContain('ignore this email')
    expect(en).not.toContain('取消訂閱')
    expect(en).not.toContain('台灣好物選物平台')
  })

  it('buildNewsletterConfirmEmail returns valid EmailMessage', async () => {
    const msg = await buildNewsletterConfirmEmail(defaultProps)
    expect(msg.to).toBe(defaultProps.to)
    expect(msg.subject).toBe('請確認訂閱 Formoria 電子報')
    expect(msg.html).toBeTruthy()
    expect(msg.headers?.['List-Unsubscribe']).toContain(
      '/api/newsletter/unsubscribe?token=unsubscribe-456',
    )
  })
})
