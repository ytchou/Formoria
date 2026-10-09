import { describe, expect, it } from 'vitest'
import { buildPrivatePageMetadata } from '../private-page-metadata'

describe('buildPrivatePageMetadata', () => {
  it('keeps the page out of the index but lets crawlers follow its links', () => {
    const metadata = buildPrivatePageMetadata({
      locale: 'zh-TW',
      title: '收藏品牌',
      description: '你在 Formoria 收藏的品牌。',
    })

    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('replaces the inherited homepage description in meta and share card', () => {
    const metadata = buildPrivatePageMetadata({
      locale: 'zh-TW',
      title: '帳號設定',
      description: '管理顯示名稱、語言和電子報設定。',
    })

    expect(metadata.title).toBe('帳號設定')
    expect(metadata.description).toBe('管理顯示名稱、語言和電子報設定。')
    expect(metadata.openGraph?.title).toBe('帳號設定')
    expect(metadata.openGraph?.description).toBe(
      '管理顯示名稱、語言和電子報設定。',
    )
    expect(metadata.twitter?.description).toBe(
      '管理顯示名稱、語言和電子報設定。',
    )
  })

  it('suppresses the home canonical and hreflang a parent layout would contribute', () => {
    const metadata = buildPrivatePageMetadata({
      locale: 'en',
      title: 'Saved brands',
      description: "The brands you've saved on Formoria.",
    })

    expect(metadata.alternates).toEqual({ canonical: null, languages: {} })
  })

  it('sets the share-card locale from the page locale, falling back to zh-TW', () => {
    const en = buildPrivatePageMetadata({ locale: 'en', title: 't', description: 'd' })
    const fallback = buildPrivatePageMetadata({ locale: 'fr', title: 't', description: 'd' })

    expect(en.openGraph?.locale).toBe('en_US')
    expect(en.openGraph?.alternateLocale).toEqual(['zh_TW'])
    expect(fallback.openGraph?.locale).toBe('zh_TW')
  })
})
