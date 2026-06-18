import { describe, it, expect } from 'vitest'
import {
  buildNewsletterEmail,
  type NewsletterBrand,
} from '@emails/templates/newsletter'

const mockBrands: NewsletterBrand[] = [
  {
    name: 'Brand A',
    slug: 'brand-a',
    imageUrl: 'https://formoria.com/images/brand-a.jpg',
    blurb: 'Handcrafted ceramics from Yingge.',
    ctaUrl: 'https://formoria.com/brands/brand-a',
  },
  {
    name: 'Brand B',
    slug: 'brand-b',
    imageUrl: 'https://formoria.com/images/brand-b.jpg',
    blurb: 'Sustainable textiles from Tainan.',
    ctaUrl: 'https://formoria.com/brands/brand-b',
  },
]

describe('buildNewsletterEmail', () => {
  it('renders multi-brand edition with brand cards', async () => {
    const email = await buildNewsletterEmail({
      to: 'subscriber@example.com',
      edition: '2026-06-18',
      brands: mockBrands,
      unsubscribeToken: 'unsub-token',
    })
    expect(email.to).toBe('subscriber@example.com')
    expect(email.from).toContain('noreply@formoria.com')
    expect(email.subject).toContain('Formoria')
    expect(email.html).toContain('Brand A')
    expect(email.html).toContain('Brand B')
    expect(email.html).toContain('Handcrafted ceramics from Yingge')
    expect(email.html).toContain('brand-a.jpg')
    expect(email.html).toContain('brands/brand-a')
    expect(email.html).toContain('Formoria')
    expect(email.html).toContain('Made in Taiwan')
    expect(email.html).toContain('取消訂閱')
    expect(email.headers?.['List-Unsubscribe']).toBeDefined()
  })

  it('renders single-brand edition', async () => {
    const email = await buildNewsletterEmail({
      to: 'subscriber@example.com',
      edition: '2026-06-18',
      brands: [mockBrands[0]],
      unsubscribeToken: 'unsub-token',
    })
    expect(email.html).toContain('Brand A')
    expect(email.html).not.toContain('Brand B')
  })

  it('is archive-friendly (self-contained HTML)', async () => {
    const email = await buildNewsletterEmail({
      to: 'subscriber@example.com',
      edition: '2026-06-18',
      brands: mockBrands,
      unsubscribeToken: 'unsub-token',
    })
    expect(email.html).toContain('<!DOCTYPE')
    expect(email.html).not.toContain('<script>')
  })
})
