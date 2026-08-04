import { describe, expect, it } from 'vitest'
import { getFooterFullDocumentHref } from './footer-links'

describe('footer full-document links', () => {
  it('localizes events and stories for each footer locale', () => {
    expect([
      getFooterFullDocumentHref('/events', 'en'),
      getFooterFullDocumentHref('/stories', 'en'),
    ]).toEqual(['/en/events', '/en/stories'])

    expect([
      getFooterFullDocumentHref('/events', 'zh-TW'),
      getFooterFullDocumentHref('/stories', 'zh-TW'),
    ]).toEqual(['/events', '/stories'])
  })
})
