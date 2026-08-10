import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectServiceRegistryViolations,
  parseServiceRegistrySource,
} from './check-service-registry.mjs'
import {
  NON_SERVICE_ENV,
  SERVICE_REGISTRY,
} from '@/lib/services/service-registry'

function writeFixture(cwd: string, file: string, source: string) {
  const path = join(cwd, file)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, source)
}

function registrySource({
  envVar = 'OPENAI_API_KEY',
  asOf = '2026-08-10',
} = {}) {
  return `
export const SERVICE_REGISTRY = [{
  id: 'fixture-service',
  envVars: ['${envVar}'],
  plan: { kind: 'free', asOf: '${asOf}' },
}]
export const NON_SERVICE_ENV = { ALLOWED_WEBHOOK_URL: 'fixture reason' }
`
}

describe('check-service-registry', () => {
  it('flags an env var missing from the registry', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'service-registry-'))
    writeFixture(
      cwd,
      'src/mystery.ts',
      'const value = process.env.MYSTERY_API_KEY',
    )

    const violations = collectServiceRegistryViolations({
      cwd,
      registrySource: registrySource(),
    })

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'MYSTERY_API_KEY',
          file: 'src/mystery.ts',
        }),
      ]),
    )
  })

  it('accepts an env var present in a registry entry', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'service-registry-'))
    writeFixture(
      cwd,
      'src/known.ts',
      'const value = process.env.OPENAI_API_KEY',
    )

    expect(
      collectServiceRegistryViolations({
        cwd,
        registrySource: registrySource(),
      }),
    ).toEqual([])
  })

  it('accepts an env var in NON_SERVICE_ENV', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'service-registry-'))
    writeFixture(
      cwd,
      'src/allowed.ts',
      'const value = process.env.ALLOWED_WEBHOOK_URL',
    )

    expect(
      collectServiceRegistryViolations({
        cwd,
        registrySource: registrySource({ envVar: 'OTHER_API_KEY' }),
      }),
    ).toEqual([])
  })

  it('ignores non-credential env vars', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'service-registry-'))
    writeFixture(
      cwd,
      'src/runtime.ts',
      'const mode = process.env.NODE_ENV\nconst preview = process.env.PREVIEW_MODE',
    )

    expect(
      collectServiceRegistryViolations({
        cwd,
        registrySource: registrySource({ envVar: 'OTHER_API_KEY' }),
      }),
    ).toEqual([])
  })

  it('flags a stale plan.asOf', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'service-registry-'))

    expect(
      collectServiceRegistryViolations({
        cwd,
        registrySource: registrySource({ asOf: '2025-01-01' }),
        now: new Date('2026-08-10T00:00:00Z'),
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'fixture-service',
          type: 'stale-plan',
        }),
      ]),
    )
  })

  it('parses the checked-in registry without drifting from its module data', () => {
    const source = readFileSync('src/lib/services/service-registry.ts', 'utf8')
    const parsed = parseServiceRegistrySource(source)
    const moduleEnvVars = new Set(
      SERVICE_REGISTRY.flatMap((entry) => entry.envVars),
    )

    expect(parsed.envVars).toEqual(moduleEnvVars)
    expect(parsed.nonServiceEnv).toEqual(new Set(Object.keys(NON_SERVICE_ENV)))
    expect(parsed.entries.map((entry) => [entry.id, entry.asOf])).toEqual(
      SERVICE_REGISTRY.map((entry) => [entry.id, entry.plan.asOf]),
    )
  })
})
