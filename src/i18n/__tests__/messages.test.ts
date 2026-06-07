import { describe, it, expect } from 'vitest'
import zhTW from '../../../messages/zh-TW.json'
import en from '../../../messages/en.json'

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )
}

type MessageTree = Record<string, unknown>

describe('message catalogs', () => {
  it('zh-TW and en have identical key sets', () => {
    expect(keys(en).sort()).toEqual(keys(zhTW).sort())
  })
  it('contains the core public namespaces', () => {
    for (const ns of ['common', 'nav', 'footer', 'landing', 'brands', 'brandDetail', 'categories', 'legal', 'faq', 'about']) {
      expect(zhTW).toHaveProperty(ns)
      expect(en).toHaveProperty(ns)
    }
  })
})

describe('about page keys (DEV-744)', () => {
  const en_about = (en as { about: MessageTree }).about
  const zh_about = (zhTW as { about: MessageTree }).about

  it('removes the team section keys in both locales', () => {
    expect(en_about.team).toBeUndefined()
    expect(zh_about.team).toBeUndefined()
  })

  it('adds the mission-led hero headline in both locales', () => {
    expect((en_about.hero as MessageTree).title).toBeTruthy()
    expect((zh_about.hero as MessageTree).title).toBeTruthy()
  })

  it('adds an explicit mission statement in both locales', () => {
    expect((en_about.mission as MessageTree).statement).toBeTruthy()
    expect((zh_about.mission as MessageTree).statement).toBeTruthy()
  })

  it('keeps about.* key sets identical across locales', () => {
    const flatten = (o: MessageTree, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === 'object' ? flatten(v as MessageTree, `${p}${k}.`) : [`${p}${k}`]
      )
    expect(flatten(en_about).sort()).toEqual(flatten(zh_about).sort())
  })
})
