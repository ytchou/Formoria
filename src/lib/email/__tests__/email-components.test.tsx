import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'
import { Layout } from '@emails/components/layout'
import { Header } from '@emails/components/header'
import { Footer } from '@emails/components/footer'
import { Button } from '@emails/components/button'
import { EmailHeading } from '@emails/components/email-heading'
import { EmailText } from '@emails/components/email-text'
import { EmailDivider } from '@emails/components/email-divider'

describe('Layout', () => {
  it('renders with header, footer, and children', async () => {
    const html = await render(
      <Layout previewText="Test preview">
        <EmailText>Hello world</EmailText>
      </Layout>
    )
    expect(html).toContain('Formoria')
    expect(html).toContain('Made in Taiwan')
    expect(html).toContain('Hello world')
    expect(html).toContain('600')
    expect(html).toContain('#FAF8F3')
  })

  it('renders unsubscribe link when provided', async () => {
    const html = await render(
      <Layout previewText="Test" unsubscribeUrl="https://formoria.com/unsub?token=abc">
        <EmailText>Content</EmailText>
      </Layout>
    )
    expect(html).toContain('unsub?token=abc')
    expect(html).toContain('取消訂閱')
  })

  it('omits unsubscribe link when not provided', async () => {
    const html = await render(
      <Layout previewText="Test">
        <EmailText>Content</EmailText>
      </Layout>
    )
    expect(html).not.toContain('取消訂閱')
  })
})

describe('Header', () => {
  it('renders logo and wordmark', async () => {
    const html = await render(<Header />)
    expect(html).toContain('Formoria')
    expect(html).toContain('#2F5D50')
  })
})

describe('Footer', () => {
  it('renders social links and tagline', async () => {
    const html = await render(<Footer />)
    expect(html).toContain('Made in Taiwan')
    expect(html).toContain('ops@formoria.com')
  })

  it('renders unsubscribe link when provided', async () => {
    const html = await render(<Footer unsubscribeUrl="https://formoria.com/unsub" />)
    expect(html).toContain('取消訂閱')
    expect(html).toContain('formoria.com/unsub')
  })
})

describe('Button', () => {
  it('renders terracotta CTA button', async () => {
    const html = await render(<Button href="https://example.com">Click me</Button>)
    expect(html).toContain('#C4693B')
    expect(html).toContain('Click me')
    expect(html).toContain('https://example.com')
  })
})

describe('EmailHeading', () => {
  it('renders styled heading', async () => {
    const html = await render(<EmailHeading>Title</EmailHeading>)
    expect(html).toContain('Title')
    expect(html).toContain('#1C1C1C')
  })
})

describe('EmailText', () => {
  it('renders body text', async () => {
    const html = await render(<EmailText>Body content</EmailText>)
    expect(html).toContain('Body content')
  })
})

describe('EmailDivider', () => {
  it('renders styled hr', async () => {
    const html = await render(<EmailDivider />)
    expect(html).toContain('#E5E0D8')
  })
})
