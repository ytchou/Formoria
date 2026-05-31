import { describe, it, expect } from 'vitest'
import { generateStaticParams } from '@/app/[locale]/layout'

describe('[locale] layout', () => {
  it('statically generates both locales', async () => {
    const params = await generateStaticParams()
    expect(params).toEqual([{ locale: 'zh-TW' }, { locale: 'en' }])
  })
})
