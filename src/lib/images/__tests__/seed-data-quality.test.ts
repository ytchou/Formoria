import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { isNonImageHost } from '../allowed-image-hosts'

function urlsIn(text: string): string[] {
  return text.match(/https?:\/\/[^\s'"\\)]+/g) ?? []
}

function splitSqlTopLevel(input: string): string[] {
  const parts: string[] = []
  let current = ''
  let inString = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    const nextChar = input[index + 1]

    current += char

    if (char === "'") {
      if (inString && nextChar === "'") {
        current += nextChar
        index += 1
        continue
      }

      inString = !inString
      continue
    }

    if (char === ',' && !inString) {
      parts.push(current.slice(0, -1).trim())
      current = ''
    }
  }

  const trailing = current.trim()
  if (trailing) {
    parts.push(trailing)
  }

  return parts
}

function extractSqlTuples(valuesSql: string): string[] {
  const tuples: string[] = []
  let start = -1
  let depth = 0
  let inString = false

  for (let index = 0; index < valuesSql.length; index += 1) {
    const char = valuesSql[index]
    const nextChar = valuesSql[index + 1]

    if (char === "'") {
      if (inString && nextChar === "'") {
        index += 1
        continue
      }

      inString = !inString
      continue
    }

    if (inString) {
      continue
    }

    if (char === '(') {
      if (depth === 0) {
        start = index + 1
      }
      depth += 1
      continue
    }

    if (char === ')') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        tuples.push(valuesSql.slice(start, index))
        start = -1
      }
    }
  }

  return tuples
}

function sqlStringValue(token: string): string | null {
  const trimmed = token.trim()

  if (trimmed.toUpperCase() === 'NULL') {
    return null
  }

  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) {
    throw new Error(`Expected SQL string literal, received: ${trimmed}`)
  }

  return trimmed.slice(1, -1).replaceAll("''", "'")
}

function jsonStringArrayValue(token: string): string[] {
  const trimmed = token.trim()

  if (trimmed.toUpperCase() === 'NULL') {
    return []
  }

  if (!trimmed.endsWith('::jsonb')) {
    throw new Error(`Expected jsonb value, received: ${trimmed}`)
  }

  const jsonLiteral = sqlStringValue(trimmed.slice(0, -'::jsonb'.length))
  if (jsonLiteral === null) {
    return []
  }

  const parsed = JSON.parse(jsonLiteral) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Expected JSON array for product_photos')
  }

  return parsed.filter((value): value is string => typeof value === 'string')
}

function imageFieldUrlsFromSql(sql: string): string[] {
  const insertMatch = /INSERT INTO brands\s*\(([\s\S]*?)\)\s*VALUES\s*/i.exec(sql)

  if (!insertMatch) {
    throw new Error('Could not find brands seed INSERT statement')
  }

  const valuesStart = insertMatch.index + insertMatch[0].length
  const onConflictIndex = sql.indexOf('\nON CONFLICT', valuesStart)
  const statementEnd = onConflictIndex === -1 ? sql.lastIndexOf(';') : onConflictIndex

  if (statementEnd === -1 || statementEnd <= valuesStart) {
    throw new Error('Could not find end of brands seed VALUES block')
  }

  const columns = splitSqlTopLevel(insertMatch[1]).map((column) => column.trim())
  const heroImageIndex = columns.indexOf('hero_image_url')
  const productPhotosIndex = columns.indexOf('product_photos')

  if (heroImageIndex === -1 || productPhotosIndex === -1) {
    throw new Error('Expected hero_image_url and product_photos columns')
  }

  const urls: string[] = []
  const valuesSql = sql.slice(valuesStart, statementEnd)

  for (const tuple of extractSqlTuples(valuesSql)) {
    const values = splitSqlTopLevel(tuple)

    if (values.length !== columns.length) {
      throw new Error(
        `Expected ${columns.length} values, received ${values.length} for tuple: ${tuple.slice(0, 80)}...`,
      )
    }

    const heroImageUrl = sqlStringValue(values[heroImageIndex])
    if (heroImageUrl) {
      urls.push(heroImageUrl)
    }

    urls.push(...jsonStringArrayValue(values[productPhotosIndex]).flatMap(urlsIn))
  }

  return urls
}

describe('seed data quality — no non-image hosts in image fields', () => {
  it('formoria-seed.sql image fields contain no tracking/non-image hosts', () => {
    const sql = readFileSync(new URL('../../../../formoria-seed.sql', import.meta.url), 'utf8')
    const offenders = imageFieldUrlsFromSql(sql).filter(isNonImageHost)

    expect(offenders).toEqual([])
  })
})
