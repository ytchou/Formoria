// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import zh from '../../../../messages/zh-TW.json'
import en from '../../../../messages/en.json'

// Mock next-intl/server before importing the page
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(),
  setRequestLocale: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import { getTranslations } from 'next-intl/server'
import FaqPage from './page'

type Messages = typeof zh

function makeT(messages: Messages, namespace: string) {
  const translate = (key: string) => {
    const parts = `${namespace}.${key}`.split('.')
    let current: unknown = messages
    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return key
      current = (current as Record<string, unknown>)[part]
    }
    return typeof current === 'string' ? current : key
  }

  const substitute = (str: string, values: Record<string, unknown>) =>
    str.replace(/\{(\w+)\}/g, (_match, name: string) =>
      typeof values[name] === 'function' ? '' : String(values[name] ?? `{${name}}`)
    )

  // Minimal next-intl t.rich shim: substitutes {placeholders} and a single <tag>…</tag>.
  const rich = (key: string, values: Record<string, unknown> = {}) => {
    const raw = translate(key)
    const tagMatch = raw.match(/<(\w+)>(.*?)<\/\1>/)
    if (!tagMatch) return substitute(raw, values)
    const [full, tagName, inner] = tagMatch
    const before = substitute(raw.slice(0, tagMatch.index ?? 0), values)
    const after = substitute(raw.slice((tagMatch.index ?? 0) + full.length), values)
    const innerText = substitute(inner, values)
    const tagFn = values[tagName]
    const rendered = typeof tagFn === 'function' ? (tagFn as (c: string) => unknown)(innerText) : innerText
    const segments = [before, rendered, after]
    return segments.every((s) => typeof s === 'string') ? segments.join('') : segments
  }

  return Object.assign((key: string) => translate(key), { rich })
}

function setupMocks(messages: Messages) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(getTranslations).mockImplementation(async (namespace: any) => {
    const t = makeT(messages, typeof namespace === 'string' ? namespace : '')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return t as any
  })
}

describe('FaqPage (zh-TW)', () => {
  beforeEach(() => setupMocks(zh as Messages))

  it('renders the 常見問題 heading', async () => {
    render(await FaqPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))
    expect(screen.getByRole('heading', { name: '常見問題' })).toBeInTheDocument()
  })

  it('renders exactly 13 accordion items', async () => {
    const { container } = render(
      await FaqPage({ params: Promise.resolve({ locale: 'zh-TW' }) })
    )
    expect(container.querySelectorAll('details')).toHaveLength(13)
  })

  it('keeps the contact prompt concise and distinguishes the contact link', async () => {
    render(await FaqPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))

    expect(screen.getByText('若仍有疑問，歡迎透過頁面底部的聯絡方式與我們聯繫。')).toBeInTheDocument()
    expect(screen.queryByText(/以下整理了訪客最常詢問/)).not.toBeInTheDocument()
    expect(screen.getByText('還有問題？')).toHaveClass('type-body-muted')
    expect(screen.getByRole('link', { name: '聯絡我們' })).toHaveClass('type-link')
  })

  it('each item has a summary child element', async () => {
    const { container } = render(
      await FaqPage({ params: Promise.resolve({ locale: 'zh-TW' }) })
    )
    expect(container.querySelectorAll('details > summary')).toHaveLength(13)
  })

  it('includes the 收錄哪些品牌 question', async () => {
    render(await FaqPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))
    expect(screen.getByText(/Formoria 收錄哪些品牌/)).toBeInTheDocument()
  })

  it('includes the 如何提交品牌 question', async () => {
    render(await FaqPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))
    expect(screen.getByText(/如何提交品牌/)).toBeInTheDocument()
  })

  it('includes the 如何聯繫 question', async () => {
    render(await FaqPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))
    expect(screen.getByText(/如何聯繫/)).toBeInTheDocument()
  })

  it('generateMetadata includes openGraph and twitter properties', async () => {
    const { generateMetadata } = await import('./page')
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'zh-TW' }) })
    expect(metadata.openGraph).toBeDefined()
    expect(metadata.openGraph).toMatchObject({
      title: expect.any(String),
      description: expect.any(String),
      locale: 'zh_TW',
    })
    expect(metadata.twitter).toBeDefined()
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      title: expect.any(String),
    })
  })
})

describe('FaqPage (en)', () => {
  beforeEach(() => setupMocks(en as unknown as Messages))

  it('renders the English FAQ heading', async () => {
    render(await FaqPage({ params: Promise.resolve({ locale: 'en' }) }))
    expect(screen.getByRole('heading', { name: 'Frequently Asked Questions' })).toBeInTheDocument()
  })

  it('includes the English What brands are listed question', async () => {
    render(await FaqPage({ params: Promise.resolve({ locale: 'en' }) }))
    expect(screen.getByText(/What brands are listed on Formoria/)).toBeInTheDocument()
  })
})
