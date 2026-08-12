#!/usr/bin/env node
/**
 * Static guard for E2E wait policies.
 *
 * E2E waits are deliberately boring to audit: numeric timeout values and
 * polling ladders are defined in e2e/budgets.ts, while specs use the named
 * BUDGET/POLL policies. This script scans the TypeScript syntax tree instead
 * of maintaining a generated census, so new syntax cannot be grandfathered by
 * updating a snapshot.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const SCAN_ROOT = 'e2e'
const BUDGETS_FILE = 'e2e/budgets.ts'

function specFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return specFiles(path)
    if (path === BUDGETS_FILE) return []
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

function sourceText(node, sourceFile) {
  return sourceFile.text.slice(node.getStart(sourceFile), node.getEnd())
}

function lineNumber(node, sourceFile) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function propertyName(property, sourceFile) {
  if (!property.name) return null
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text
  }
  return sourceText(property.name, sourceFile)
}

function unwrapExpression(node) {
  let expression = node
  while (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    expression = expression.expression
  }
  return expression
}

function loadPolicyNames() {
  const source = readFileSync(BUDGETS_FILE, 'utf8')
  const sourceFile = ts.createSourceFile(
    BUDGETS_FILE,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const budgets = new Set()
  const polls = new Set()

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      (node.name.text === 'BUDGET' || node.name.text === 'POLL')
    ) {
      const root = node.name.text
      const initializer = unwrapExpression(node.initializer)
      if (ts.isObjectLiteralExpression(initializer)) {
        for (const property of initializer.properties) {
          const name = propertyName(property, sourceFile)
          if (!name || !ts.isPropertyAssignment(property)) continue
          const value = unwrapExpression(property.initializer)
          if (root === 'POLL') {
            if (ts.isObjectLiteralExpression(value)) polls.add(`POLL.${name}`)
            continue
          }
          if (name === 'TEST' && ts.isObjectLiteralExpression(value)) {
            for (const testProperty of value.properties) {
              const testName = propertyName(testProperty, sourceFile)
              if (testName) budgets.add(`BUDGET.TEST.${testName}`)
            }
          } else {
            budgets.add(`BUDGET.${name}`)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  if (budgets.size === 0 || polls.size === 0) {
    throw new Error(`Could not load named policies from ${BUDGETS_FILE}`)
  }
  return { budgets, polls }
}

function isNamedBudget(node, sourceFile, policies) {
  const text = sourceText(node, sourceFile).replace(/\s+/g, '')
  return policies.budgets.has(text) || policies.polls.has(text.replace(/\.(?:timeout|intervals)$/, ''))
}

function isNamedTestBudget(node, sourceFile, policies) {
  return policies.budgets.has(sourceText(node, sourceFile).replace(/\s+/g, '')) &&
    sourceText(node, sourceFile).replace(/\s+/g, '').startsWith('BUDGET.TEST.')
}

function isNamedPoll(node, sourceFile, policies) {
  return policies.polls.has(sourceText(node, sourceFile).replace(/\s+/g, ''))
}

function hasNamedPollSpread(node, sourceFile, policies) {
  return (
    ts.isObjectLiteralExpression(node) &&
    node.properties.some(
      (property) =>
        ts.isSpreadAssignment(property) && isNamedPoll(property.expression, sourceFile, policies),
    )
  )
}

function methodName(expression) {
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : null
}

function isTestSetTimeout(expression) {
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'setTimeout' &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'test'
  )
}

function scanFile(file, policies) {
  const source = readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const violations = []

  for (const diagnostic of sourceFile.parseDiagnostics) {
    const position = diagnostic.start ?? 0
    const line = sourceFile.getLineAndCharacterOfPosition(position).line + 1
    violations.push({
      file: relative('.', file),
      line,
      rule: 'parse error',
      detail: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    })
  }

  const report = (node, rule, detail) => {
    violations.push({
      file: relative('.', file),
      line: lineNumber(node, sourceFile),
      rule,
      detail,
    })
  }

  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        const name = propertyName(property, sourceFile)

        if (name === 'timeout') {
          const value = ts.isPropertyAssignment(property)
            ? property.initializer
            : ts.isShorthandPropertyAssignment(property)
              ? property.name
              : null

          if (!value || !isNamedBudget(value, sourceFile, policies)) {
            const detail = value && ts.isNumericLiteral(value)
              ? 'numeric timeout values belong in e2e/budgets.ts'
              : 'timeout must resolve to a named BUDGET/POLL policy'
            report(property, 'custom timeout', detail)
          }
        }

        if (name === 'intervals') {
          const value = ts.isPropertyAssignment(property) ? property.initializer : null
          if (!value || !isNamedBudget(value, sourceFile, policies)) {
            report(
              property,
              'inline polling intervals',
              'polling intervals belong in e2e/budgets.ts and must be used through POLL.<NAME>',
            )
          }
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const name = methodName(node.expression)

      if (isTestSetTimeout(node.expression)) {
        const value = node.arguments[0]
        if (!value || !isNamedTestBudget(value, sourceFile, policies)) {
          report(
            node,
            'custom test timeout',
            'test.setTimeout must use a named BUDGET.TEST policy',
          )
        }
      }

      if (name === 'waitForTimeout') {
        report(node, 'hard sleep', 'wait for a readiness condition instead of sleeping')
      }

      if (
        (ts.isIdentifier(node.expression) && node.expression.text === 'setTimeout') ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'setTimeout' &&
          !isTestSetTimeout(node.expression))
      ) {
        report(
          node,
          'hard sleep',
          'use a readiness condition or named polling policy instead of setTimeout',
        )
      }

      if (name === 'toPass') {
        const policy = node.arguments[0]
        if (!policy) {
          report(node, 'bare toPass', 'toPass must use a named POLL policy')
        } else if (
          !isNamedPoll(policy, sourceFile, policies) &&
          !hasNamedPollSpread(policy, sourceFile, policies)
        ) {
          report(node, 'custom toPass policy', 'toPass must use POLL.<NAME>')
        }
      }

      if (name === 'poll' && node.arguments.length > 1) {
        const options = node.arguments[1]
        if (
          !isNamedPoll(options, sourceFile, policies) &&
          !hasNamedPollSpread(options, sourceFile, policies)
        ) {
          const hasOnlyMessage =
            ts.isObjectLiteralExpression(options) &&
            options.properties.every((property) => propertyName(property, sourceFile) === 'message')
          if (!hasOnlyMessage) {
            report(node, 'custom poll policy', 'expect.poll must use POLL.<NAME> for custom wait policy')
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

const args = process.argv.slice(2)
if (args.length > 0) {
  console.error('✖ e2e timeout guard accepts no arguments; snapshot mode was removed')
  process.exit(1)
}

const files = specFiles(SCAN_ROOT)
const policies = loadPolicyNames()
const violations = files
  .flatMap((file) => scanFile(file, policies))
  .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule))

if (violations.length > 0) {
  console.error(`✖ e2e timeout guard: ${violations.length} violation(s)\n`)
  for (const violation of violations) {
    console.error(`  - ${violation.file}:${violation.line} ${violation.rule}: ${violation.detail}`)
  }
  process.exit(1)
}

console.log(`e2e timeout guard passed (${files.length} files scanned).`)
