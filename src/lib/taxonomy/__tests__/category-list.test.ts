import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'

import en from '../../../../messages/en.json'
import zhTW from '../../../../messages/zh-TW.json'
import { visibleCategoryList } from '../category-list'
import { L1_CATEGORIES, VISIBLE_L1_CATEGORIES } from '../ontology'

type TranslatorOptions = Parameters<typeof createTranslator>[0]
type Translate = (key: string, values: Record<string, string | number>) => string

const DEFERRED = L1_CATEGORIES.filter(c => 'deferred' in c)

describe('visibleCategoryList', () => {
  it('counts the visible L1 categories, not every L1', () => {
    expect(visibleCategoryList('zh-TW').count).toBe(VISIBLE_L1_CATEGORIES.length)
    expect(visibleCategoryList('en').count).toBe(VISIBLE_L1_CATEGORIES.length)
    expect(VISIBLE_L1_CATEGORIES.length).toBeLessThan(L1_CATEGORIES.length)
  })

  it('names every visible category and no deferred one, in both locales', () => {
    const zh = visibleCategoryList('zh-TW').categories
    const enList = visibleCategoryList('en').categories

    for (const category of VISIBLE_L1_CATEGORIES) {
      expect(zh).toContain(category.nameZh)
      expect(enList).toContain(category.name)
    }
    for (const category of DEFERRED) {
      expect(zh).not.toContain(category.nameZh)
      expect(enList).not.toContain(category.name)
    }
    expect(zh).not.toContain('食品飲料')
    expect(enList).not.toContain('Food & Beverage')
  })

  it('joins zh-TW with 、 and English as a written-out list', () => {
    const zh = visibleCategoryList('zh-TW').categories
    expect(zh.split('、')).toHaveLength(VISIBLE_L1_CATEGORIES.length)

    const enList = visibleCategoryList('en').categories
    const last = VISIBLE_L1_CATEGORIES.at(-1)
    expect(last).toBeDefined()
    expect(enList.endsWith(`, and ${last?.name}`)).toBe(true)
  })
})

// The FAQ answer used to hard-code "twelve categories" and drifted from the
// site. These pin the catalogue to placeholders so it cannot drift back.
describe('faq.items.whatCategories.answer', () => {
  const catalogs = [
    ['zh-TW', zhTW, 'nameZh'],
    ['en', en, 'name'],
  ] as const

  it.each(catalogs)('%s takes count and categories as values', (_locale, messages, field) => {
    const answer = messages.faq.items.whatCategories.answer
    expect(answer).toContain('{count')
    expect(answer).toContain('{categories}')
    for (const category of L1_CATEGORIES) {
      expect(answer).not.toContain(category[field])
    }
  })

  it.each(catalogs)('%s renders the visible list through ICU', (locale, messages) => {
    // Same cast as the other createTranslator call sites: the catalogs are a
    // union of two JSON shapes, which next-intl's key inference cannot take.
    const t = createTranslator({
      locale,
      messages,
      namespace: 'faq.items.whatCategories',
    } as unknown as TranslatorOptions) as unknown as Translate
    const { count, categories } = visibleCategoryList(locale)
    const rendered = t('answer', { count, categories })

    expect(rendered).toContain(String(count))
    expect(rendered).toContain(categories)
  })
})
