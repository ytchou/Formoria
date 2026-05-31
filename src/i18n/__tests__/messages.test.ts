import { describe, it, expect } from 'vitest'
import zh from '../../../messages/zh-TW.json'
import en from '../../../messages/en.json'

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )
}

describe('message catalogs', () => {
  it('zh-TW and en have identical key sets', () => {
    expect(keys(en).sort()).toEqual(keys(zh).sort())
  })
  it('contains the core public namespaces', () => {
    for (const ns of ['common', 'nav', 'footer', 'landing', 'brands', 'brandDetail', 'categories', 'legal', 'faq', 'about']) {
      expect(zh).toHaveProperty(ns)
      expect(en).toHaveProperty(ns)
    }
  })
})
