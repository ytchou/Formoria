import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectFrontendTokenFailures } from './check-frontend-type-tokens.mjs'

function writeFixture(cwd: string, file: string, source: string) {
  const path = join(cwd, file)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, source)
}

describe('check-frontend-type-tokens', () => {
  it('flags direct frontend typography and raw color drift', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'frontend-tokens-'))

    writeFixture(
      cwd,
      'src/components/example.tsx',
      '<p className="font-heading text-[22px] bg-[#FFFFFF]">Bad</p>',
    )

    expect(collectFrontendTokenFailures({ cwd })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'direct heading font' }),
        expect.objectContaining({ name: 'arbitrary numeric text size' }),
        expect.objectContaining({ name: 'raw hex color class' }),
      ]),
    )
  })

  it('scans TypeScript design source files', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'frontend-tokens-'))

    writeFixture(
      cwd,
      'src/components/ui/text-styles.ts',
      'export const bad = "font-heading text-[22px] bg-[#FFFFFF]"',
    )

    expect(collectFrontendTokenFailures({ cwd })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'src/components/ui/text-styles.ts',
          name: 'direct heading font',
        }),
        expect.objectContaining({
          file: 'src/components/ui/text-styles.ts',
          name: 'arbitrary numeric text size',
        }),
      ]),
    )
  })

  it('allows only explicit platform and brand-accent exceptions', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'frontend-tokens-'))

    writeFixture(
      cwd,
      'src/components/auth/google-button.tsx',
      '<path fill="#4285F4" />',
    )
    writeFixture(
      cwd,
      'src/components/microsite/contact-cta.tsx',
      '<p className="text-[13px]">CTA</p>',
    )
    writeFixture(
      cwd,
      'src/components/brands/share-dialog.tsx',
      '<span className="text-[#07B53B] text-[#123456]" />',
    )

    expect(collectFrontendTokenFailures({ cwd })).toEqual([
      expect.objectContaining({
        file: 'src/components/brands/share-dialog.tsx',
        name: 'raw hex color class',
        value: 'text-[#123456]',
      }),
      expect.objectContaining({
        file: 'src/components/brands/share-dialog.tsx',
        name: 'raw hex color literal',
        value: '#123456',
      }),
    ])
  })

  it('flags hand-picked text-size + font-weight combos outside ui/', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'frontend-tokens-'))

    writeFixture(
      cwd,
      'src/components/brands/sample.tsx',
      '<span className="text-sm font-medium text-foreground">x</span>',
    )

    const failures = collectFrontendTokenFailures({ cwd })
    expect(failures.some((f) => f.name === 'raw-type-combo')).toBe(true)
  })

  it('accepts type-label as a compliant role (no raw-type-combo flag)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'frontend-tokens-'))
    writeFixture(cwd, 'src/components/admin/sample.tsx', '<span className="type-label">高風險</span>')
    const failures = collectFrontendTokenFailures({ cwd })
    expect(failures.some((f) => f.name === 'raw-type-combo')).toBe(false)
  })

  it('does not flag combos inside ui/ primitives', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'frontend-tokens-'))

    writeFixture(
      cwd,
      'src/components/ui/button.tsx',
      '"text-sm font-medium"',
    )

    const failures = collectFrontendTokenFailures({ cwd })
    expect(failures.some((f) => f.name === 'raw-type-combo')).toBe(false)
  })
})
