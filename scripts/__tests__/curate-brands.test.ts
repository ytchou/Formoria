import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCliArgs } from '../curate-brands'

describe('parseCliArgs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses enrich command with phases', () => {
    const args = parseCliArgs(['enrich', '--phases=discover,links,descriptions,locations'])
    expect(args.command).toBe('enrich')
    expect(args.config.phases).toEqual(['discover', 'links', 'descriptions', 'locations'])
  })

  it('defaults enrich phases to all when not specified', () => {
    const args = parseCliArgs(['enrich'])
    expect(args.command).toBe('enrich')
    expect(args.config.phases).toEqual([
      'clean',
      'detect',
      'slugs',
      'tags',
      'discover',
      'links',
      'images',
      'classify_images',
      'descriptions',
      'locations',
      'expansion',
    ])
  })

  it('rejects old deprecated commands', () => {
    expect(() => parseCliArgs(['set-visibility'])).toThrow(/unknown command/i)
    expect(() => parseCliArgs(['clean-names'])).toThrow(/unknown command/i)
    expect(() => parseCliArgs(['normalize-slugs'])).toThrow(/unknown command/i)
    expect(() => parseCliArgs(['detect-non-brands'])).toThrow(/unknown command/i)
    expect(() => parseCliArgs(['enrich-descriptions'])).toThrow(/unknown command/i)
  })

  it('should log deprecation warning when --status provided without --slugs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    parseCliArgs(['enrich', '--status=approved'])

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('--status without --slugs is deprecated'))
  })

  it('should not warn when --status and --slugs both provided', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    parseCliArgs(['enrich', '--status=approved', '--slugs=brand-a'])

    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('--status without --slugs is deprecated')
    )
  })
})
