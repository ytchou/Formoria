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

  it('renders exactly 8 accordion items', async () => {
    const { container } = render(
      await FaqPage({ params: Promise.resolve({ locale: 'zh-TW' }) })
    )
    expect(container.querySelectorAll('details')).toHaveLength(8)
  })

  it('each item has a summary child element', async () => {
    const { container } = render(
      await FaqPage({ params: Promise.resolve({ locale: 'zh-TW' }) })
    )
    expect(container.querySelectorAll('details > summary')).toHaveLength(8)
  })

  it('includes the 什麼是 Formoria question', async () => {
    render(await FaqPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))
    expect(screen.getByText(/什麼是 Formoria/)).toBeInTheDocument()
  })

  it('includes the 如何提交品牌 question', async () => {
    render(await FaqPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))
    expect(screen.getByText(/如何提交品牌/)).toBeInTheDocument()
  })

  it('includes the 如何聯繫 question', async () => {
    render(await FaqPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))
    expect(screen.getByText(/如何聯繫/)).toBeInTheDocument()
  })

  it('includes FAQPage JSON-LD script tag', async () => {
    const { container } = render(
      await FaqPage({ params: Promise.resolve({ locale: 'zh-TW' }) })
    )
    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script).toBeInTheDocument()
    const jsonLd = JSON.parse(script!.textContent!)
    expect(jsonLd['@type']).toBe('FAQPage')
  })
})

describe('FaqPage (en)', () => {
  beforeEach(() => setupMocks(en as unknown as Messages))

  it('renders the English FAQ heading', async () => {
    render(await FaqPage({ params: Promise.resolve({ locale: 'en' }) }))
    expect(screen.getByRole('heading', { name: 'Frequently Asked Questions' })).toBeInTheDocument()
  })

  it('includes the English What is Formoria question', async () => {
    render(await FaqPage({ params: Promise.resolve({ locale: 'en' }) }))
    expect(screen.getByText(/What is Formoria/)).toBeInTheDocument()
  })
})
