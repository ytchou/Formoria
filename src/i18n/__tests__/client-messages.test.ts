import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { AbstractIntlMessages } from 'next-intl'

import {
  CLIENT_MESSAGE_NAMESPACES,
  NON_LITERAL_NAMESPACE_CALLERS,
  pickClientMessages,
} from '@/i18n/client-messages'

/**
 * Guard for DEV-1972: `[locale]/layout.tsx` sends only CLIENT_MESSAGE_NAMESPACES
 * to the client. A `useTranslations` call on any other namespace renders raw
 * keys with no build or type error, so this scan is the only thing that
 * catches it.
 */

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/**
 * `admin` is en-only and rendered under `src/app/admin/layout.tsx`, whose own
 * provider passes the full catalogue. Files in these trees may read it.
 */
const ADMIN_TREES = ['src/app/admin/', 'src/components/admin/']

const CALL = /\buseTranslations\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g
const STRING_LITERAL = /^(['"])([^'"]*)\1$|^`([^`$]*)`$/

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function sourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') sourceFiles(full, files)
      continue
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full)
  }
  return files
}

function readCatalog(locale: string): AbstractIntlMessages {
  return JSON.parse(readFileSync(join(ROOT, 'messages', `${locale}.json`), 'utf8'))
}

const files = sourceFiles(SRC).map((full) => ({
  path: toPosix(relative(ROOT, full)),
  source: readFileSync(full, 'utf8'),
}))

const clientNamespaces: readonly string[] = CLIENT_MESSAGE_NAMESPACES

describe('client message namespaces', () => {
  it('lists the top-level namespace of every literal useTranslations call', () => {
    const missing: string[] = []
    for (const { path, source } of files) {
      const inAdminTree = ADMIN_TREES.some((prefix) => path.startsWith(prefix))
      for (const [, rawArg] of source.matchAll(CALL)) {
        const literal = rawArg.trim().match(STRING_LITERAL)
        if (!literal) continue
        const namespace = (literal[2] ?? literal[3] ?? '').split('.')[0]
        if (!namespace) continue
        if (inAdminTree && namespace === 'admin') continue
        if (!clientNamespaces.includes(namespace)) missing.push(`${path}: '${namespace}'`)
      }
    }
    expect(
      missing,
      'Add these namespaces to CLIENT_MESSAGE_NAMESPACES in src/i18n/client-messages.ts, ' +
        'or the client renders raw message keys',
    ).toEqual([])
  })

  it('registers every non-literal or empty useTranslations call', () => {
    const unregistered: string[] = []
    const callersFound = new Set<string>()
    for (const { path, source } of files) {
      for (const [, rawArg] of source.matchAll(CALL)) {
        const arg = rawArg.trim()
        if (arg && STRING_LITERAL.test(arg)) continue
        callersFound.add(path)
        if (!(path in NON_LITERAL_NAMESPACE_CALLERS)) {
          unregistered.push(`${path}: useTranslations(${arg})`)
        }
      }
    }
    expect(
      unregistered,
      'Add each file to NON_LITERAL_NAMESPACE_CALLERS in src/i18n/client-messages.ts ' +
        'with every namespace its call can resolve to, and add those namespaces to ' +
        'CLIENT_MESSAGE_NAMESPACES',
    ).toEqual([])
    expect(
      Object.keys(NON_LITERAL_NAMESPACE_CALLERS).filter((path) => !callersFound.has(path)),
      'Stale NON_LITERAL_NAMESPACE_CALLERS entries: the file no longer makes a non-literal call',
    ).toEqual([])
  })

  it('lists every namespace a non-literal caller reads', () => {
    for (const namespaces of Object.values(NON_LITERAL_NAMESPACE_CALLERS)) {
      for (const namespace of namespaces) expect(clientNamespaces).toContain(namespace)
    }
  })

  it('never reads the raw catalogue with useMessages', () => {
    const offenders = files
      .filter(({ source }) => /\buseMessages\s*\(/.test(source))
      .map(({ path }) => path)
    expect(
      offenders,
      'useMessages reads the trimmed client catalogue; use useTranslations or pass copy as props',
    ).toEqual([])
  })

  it('keeps admin components inside the admin provider', () => {
    const outside = files
      .filter(({ path }) => !ADMIN_TREES.some((prefix) => path.startsWith(prefix)))
      .filter(({ source }) => /from\s+['"]@\/components\/admin\//.test(source))
      .map(({ path }) => path)
    expect(outside).toEqual([])
  })

  it.each(['zh-TW', 'en'])('exists as a top-level key in messages/%s.json', (locale) => {
    const catalog = readCatalog(locale)
    expect(clientNamespaces.filter((namespace) => !(namespace in catalog))).toEqual([])
  })

  it('keeps exactly the client namespaces and drops server-only ones', () => {
    const zh = readCatalog('zh-TW')
    expect(zh).toHaveProperty('categories')
    expect(clientNamespaces).not.toContain('categories')

    const picked = pickClientMessages(zh)
    expect(Object.keys(picked).sort()).toEqual([...clientNamespaces].sort())
    expect(picked).not.toHaveProperty('categories')
    expect(picked.nav).toBe(zh.nav)

    const en = readCatalog('en')
    expect(en).toHaveProperty('admin')
    expect(pickClientMessages(en)).not.toHaveProperty('admin')
  })
})
