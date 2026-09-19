/**
 * Registry tests — compile-time Record + runtime parity with DETECTOR_NAMES.
 */

import { describe, expect, it, vi } from 'vitest'
import { DETECTOR_NAMES } from '@/lib/constants/health-detectors'
import { registry } from '../registry'
import type { DetectorContext } from '../types'

describe('registry', () => {
  it('has an entry for every detector name', () => {
    const registryNames = new Set(Object.keys(registry))
    const expectedNames = new Set<string>(DETECTOR_NAMES)

    // Every DETECTOR_NAMES entry must be in the registry
    for (const name of DETECTOR_NAMES) {
      expect(
        registryNames.has(name),
        `missing registry entry for "${name}"`,
      ).toBe(true)
    }

    // No extra entries in the registry
    for (const name of registryNames) {
      expect(
        expectedNames.has(name),
        `unexpected registry entry "${name}"`,
      ).toBe(true)
    }

    // Length parity
    expect(Object.keys(registry).length).toBe(DETECTOR_NAMES.length)
  })

  it('every registry entry has the correct name and source', () => {
    for (const name of DETECTOR_NAMES) {
      const detector = registry[name]
      expect(detector.name).toBe(name)
      // source must be a non-empty string
      expect(detector.source.length).toBeGreaterThan(0)
    }
  })

  it('wires the configured GitHub credentials through the Dependabot adapter', async () => {
    const signal = new AbortController().signal
    const fetchFn = vi.fn().mockResolvedValue(
      Response.json([
        {
          number: 41,
          state: 'open',
          dependency: { package: { name: 'next' } },
          security_advisory: { severity: 'critical' },
        },
      ]),
    )
    const ctx: DetectorContext = {
      date: '2026-09-19',
      deadline: Date.now() + 60_000,
      signal,
      dryRun: true,
      deps: {
        env: {
          GITHUB_TOKEN: 'railway-github-token',
          GITHUB_REPOSITORY: 'formoria/example',
        },
        fetchFn,
      },
    }

    await expect(registry.dependabot.run(ctx)).resolves.toEqual([
      expect.objectContaining({
        fingerprint: 'directory:dependabot:41',
      }),
    ])
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.github.com/repos/formoria/example/dependabot/alerts?state=open&per_page=100',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer railway-github-token',
        }),
        signal,
      }),
    )
  })
})
