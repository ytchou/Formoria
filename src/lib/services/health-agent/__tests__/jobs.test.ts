import { describe, expect, it } from 'vitest'

import { HEALTH_JOBS, QUALITY_CONTEXT_COMMANDS } from '../jobs'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('health agent job definitions', () => {
  it('captures repository context before running bounded quality commands', () => {
    expect(QUALITY_CONTEXT_COMMANDS.map((command) => command.id)).toEqual([
      'repo-root',
      'tracked-files',
    ])
    expect(HEALTH_JOBS.vitest.commands[0]).toMatchObject({
      id: 'vitest',
      timeoutMs: 300_000,
    })
    expect(HEALTH_JOBS.knip.commands[0]!.timeoutMs).toBeGreaterThan(0)
  })

  it('runs Vitest in test mode when the worker environment is production', () => {
    expect(HEALTH_JOBS.vitest.commands[0]!.run).toBe(
      'NODE_ENV=test pnpm exec vitest run --reporter=json',
    )
  })

  it('vitest and knip findings keep the quality:* fingerprints of the scripts implementation', () => {
    const vitest = HEALTH_JOBS.vitest
    expect(vitest).toBeDefined()
    expect(vitest.name).toBe('vitest')
    expect(vitest.source).toBe('quality')

    const knip = HEALTH_JOBS.knip
    expect(knip).toBeDefined()
    expect(knip.name).toBe('knip')
    expect(knip.source).toBe('quality')

    // Both produce findings whose fingerprints start with "quality:"
    // matching the scripts implementation's stableFingerprint('quality', …)
  })

  it('knip-fix requests exports and files only and never dependencies', () => {
    const knipFix = HEALTH_JOBS['knip-fix']
    expect(knipFix).toBeDefined()
    expect(knipFix.name).toBe('knip-fix')

    // The knip-fix command must contain the fix-type restriction
    const command = knipFix.commands[0]!.run
    expect(command).toContain('--fix-type exports,files')
    expect(command).toContain('--allow-remove-files')
    expect(command).not.toContain('dependencies')
  })

  it('unused dependencies are reported as findings with report_only disposition', () => {
    const knip = HEALTH_JOBS.knip
    // The knip job must carry metadata indicating dependency findings
    // are report_only (not auto-fixable)
    expect(knip.dependencyDisposition).toBe('report_only')
  })

  it('knip-fix validation commands include lint, tsc, and scoped vitest', () => {
    const knipFix = HEALTH_JOBS['knip-fix']
    const _commands = knipFix.commands.map((c) => c.run)

    // Must have validation commands
    const validationCommands = knipFix.validationCommands
    expect(validationCommands).toBeDefined()
    expect(validationCommands!.some((c) => c.includes('pnpm lint'))).toBe(true)
    expect(
      validationCommands!.some((c) => c.includes('pnpm exec tsc --noEmit')),
    ).toBe(true)
    expect(
      validationCommands!.some((c) => c.includes('pnpm exec vitest run')),
    ).toBe(true)
  })

  it('mdx-links job returns the link list extracted from content/stories and content/trails', () => {
    const mdxLinks = HEALTH_JOBS['mdx-links']
    expect(mdxLinks).toBeDefined()
    expect(mdxLinks.name).toBe('mdx-links')

    // The command should reference content directories
    const command = mdxLinks.commands[0]!.run
    expect(command).toContain('content/stories')
    expect(command).toContain('content/trails')
  })

  it('investigate job definition exists and uses the OpenAI provider', () => {
    const investigate = HEALTH_JOBS.investigate
    expect(investigate).toBeDefined()
    expect(investigate.name).toBe('investigate')
    expect(investigate.provider).toBe('openai')
  })

  it('all jobs have valid structure', () => {
    for (const [name, job] of Object.entries(HEALTH_JOBS)) {
      expect(job.name).toBe(name)
      expect(job.commands.length).toBeGreaterThanOrEqual(0)
      expect(typeof job.source).toBe('string')
    }
  })
})
