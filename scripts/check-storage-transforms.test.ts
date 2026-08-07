import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectStorageTransformFailures } from './check-storage-transforms.mjs'

function writeFixture(cwd: string, file: string, source: string) {
  const path = join(cwd, file)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, source)
}

describe('check-storage-transforms', () => {
  it('flags a hand-built render endpoint URL', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'storage-transforms-'))

    writeFixture(
      cwd,
      'src/lib/services/thumb.ts',
      'export const u = `${base}/storage/v1/render/image/public/brand-images/${key}?width=512`',
    )

    expect(collectStorageTransformFailures({ cwd })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'src/lib/services/thumb.ts',
          name: 'render endpoint URL',
        }),
      ]),
    )
  })

  it('flags the supabase-js transform option, which builds no URL literal', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'storage-transforms-'))

    writeFixture(
      cwd,
      'src/lib/services/signed.ts',
      [
        'const { data } = await supabase.storage',
        "  .from('brand-images')",
        "  .createSignedUrl(key, 60, {",
        '    transform: { width: 512 },',
        '  })',
      ].join('\n'),
    )

    const failures = collectStorageTransformFailures({ cwd })
    expect(
      failures.some((f) => f.name === 'transform option on a storage URL call'),
    ).toBe(true)
  })

  it('scans scripts and edge functions, not just src', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'storage-transforms-'))

    writeFixture(cwd, 'scripts/thumb.mjs', "const u = '/storage/v1/render/image'")
    writeFixture(
      cwd,
      'supabase/functions/og/index.ts',
      "const u = '/storage/v1/render/image'",
    )

    expect(
      collectStorageTransformFailures({ cwd }).map((f) => f.file).sort(),
    ).toEqual(['scripts/thumb.mjs', 'supabase/functions/og/index.ts'])
  })

  it('passes on plain object URLs and untransformed public URLs', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'storage-transforms-'))

    writeFixture(
      cwd,
      'src/lib/services/plain.ts',
      [
        "const url = `${base}/storage/v1/object/public/brand-images/${key}`",
        "const { data } = supabase.storage.from('brand-images').getPublicUrl(key)",
      ].join('\n'),
    )

    expect(collectStorageTransformFailures({ cwd })).toEqual([])
  })
})
