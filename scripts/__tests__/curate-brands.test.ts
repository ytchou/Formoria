import { describe, it, expect } from 'vitest'
import { parseCliArgs } from '../curate-brands'

describe('parseCliArgs', () => {
  it('parses enrich command with phases', () => {
    const args = parseCliArgs(['enrich', '--phases=discover,links,descriptions'])
    expect(args.command).toBe('enrich')
    expect(args.config.phases).toEqual(['discover', 'links', 'descriptions'])
  })

  it('defaults enrich phases to all when not specified', () => {
    const args = parseCliArgs(['enrich'])
    expect(args.command).toBe('enrich')
    expect(args.config.phases).toEqual(['clean', 'detect', 'slugs', 'tags', 'discover', 'links', 'images', 'descriptions'])
  })

  it('rejects old deprecated commands', () => {
    expect(() => parseCliArgs(['set-visibility'])).toThrow(/unknown command/i)
    expect(() => parseCliArgs(['clean-names'])).toThrow(/unknown command/i)
    expect(() => parseCliArgs(['normalize-slugs'])).toThrow(/unknown command/i)
    expect(() => parseCliArgs(['detect-non-brands'])).toThrow(/unknown command/i)
    expect(() => parseCliArgs(['enrich-descriptions'])).toThrow(/unknown command/i)
  })
})
