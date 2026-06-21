import { describe, it, expect } from 'vitest'
import { parseCliArgs } from '../curate-brands'

describe('parseCliArgs', () => {
  it('parses cleanup command with flags', () => {
    const args = parseCliArgs(['cleanup', '--dry-run', '--slugs=a,b', '--limit=10'])
    expect(args.command).toBe('cleanup')
    expect(args.config.dryRun).toBe(true)
    expect(args.config.slugs).toEqual(['a', 'b'])
    expect(args.config.limit).toBe(10)
  })

  it('parses enrich command with phases', () => {
    const args = parseCliArgs(['enrich', '--phases=discover,links,descriptions'])
    expect(args.command).toBe('enrich')
    expect(args.config.phases).toEqual(['discover', 'links', 'descriptions'])
  })

  it('defaults enrich phases to all when not specified', () => {
    const args = parseCliArgs(['enrich'])
    expect(args.command).toBe('enrich')
    expect(args.config.phases).toEqual(['discover', 'links', 'images', 'descriptions'])
  })

  it('parses auto-tag command', () => {
    const args = parseCliArgs(['auto-tag', '--dry-run'])
    expect(args.command).toBe('auto-tag')
    expect(args.config.dryRun).toBe(true)
  })

  it('parses set-visibility command', () => {
    const args = parseCliArgs(['set-visibility'])
    expect(args.command).toBe('set-visibility')
  })

  it('rejects old deprecated commands', () => {
    expect(() => parseCliArgs(['clean-names'])).toThrow(/unknown command/i)
    expect(() => parseCliArgs(['normalize-slugs'])).toThrow(/unknown command/i)
    expect(() => parseCliArgs(['detect-non-brands'])).toThrow(/unknown command/i)
    expect(() => parseCliArgs(['enrich-descriptions'])).toThrow(/unknown command/i)
  })
})
