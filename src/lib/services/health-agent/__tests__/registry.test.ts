/**
 * Registry tests — compile-time Record + runtime parity with DETECTOR_NAMES.
 */

import { describe, expect, it } from 'vitest'
import { DETECTOR_NAMES } from '@/lib/constants/health-detectors'
import { registry } from '../registry'

describe('registry', () => {
  it('has an entry for every detector name', () => {
    const registryNames = new Set(Object.keys(registry))
    const expectedNames = new Set<string>(DETECTOR_NAMES)

    // Every DETECTOR_NAMES entry must be in the registry
    for (const name of DETECTOR_NAMES) {
      expect(registryNames.has(name), `missing registry entry for "${name}"`).toBe(true)
    }

    // No extra entries in the registry
    for (const name of registryNames) {
      expect(expectedNames.has(name), `unexpected registry entry "${name}"`).toBe(true)
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
})
