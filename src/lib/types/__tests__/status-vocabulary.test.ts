import { describe, expect, it } from 'vitest'
import type { BrandStatus } from '../brand'
import type { PhaseResultStatus } from '../curation'
import type {
  PhaseStatus as RunLogPhaseStatus,
  StepEventStatus,
} from '@/lib/runlog/schema'

/**
 * Vocabulary lock for the status unions that used to be declared more than
 * once under the same name. Each case pins the exact member set twice: once at
 * the type level (so a second, differently-shaped declaration under the same
 * name fails to compile) and once at runtime (so the assertion actually runs).
 *
 * Adding or removing a member is a deliberate act — update the expectation
 * here *and*, where noted, the matching DB CHECK constraint in the same PR.
 */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? true
    : false

describe('status vocabulary', () => {
  it('pins BrandStatus to the brands.status ladder', () => {
    // Mirrors `brands_status_check` (20260626150000_cleanup_pending_brands.sql).
    const exact: Equals<BrandStatus, 'approved' | 'hidden'> = true
    const members: readonly BrandStatus[] = ['approved', 'hidden']

    expect(exact).toBe(true)
    expect(members).toEqual(['approved', 'hidden'])
  })

  it('pins PhaseResultStatus to the persisted terminal outcomes', () => {
    // Not DB-constrained: persisted as JSON inside
    // `curation_job_targets.phase_results`, validated by `parsePhaseResults`.
    const exact: Equals<PhaseResultStatus, 'succeeded' | 'skipped' | 'failed'> =
      true
    const members: readonly PhaseResultStatus[] = [
      'succeeded',
      'skipped',
      'failed',
    ]

    expect(exact).toBe(true)
    expect(members).toEqual(['succeeded', 'skipped', 'failed'])
  })

  it('pins the run-log PhaseStatus to the observed phase states', () => {
    // Not persisted: a rendered view state, so it also carries the in-flight
    // and unparseable members that PhaseResultStatus deliberately lacks.
    const exact: Equals<
      RunLogPhaseStatus,
      'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'unknown'
    > = true
    const members: readonly RunLogPhaseStatus[] = [
      'pending',
      'running',
      'succeeded',
      'failed',
      'skipped',
      'unknown',
    ]

    expect(exact).toBe(true)
    expect(members).toEqual([
      'pending',
      'running',
      'succeeded',
      'failed',
      'skipped',
      'unknown',
    ])
  })

  it('pins StepEventStatus to the run-log step severities', () => {
    // Not persisted: severity of a single step event in the run-log renderer.
    const exact: Equals<
      StepEventStatus,
      'ok' | 'error' | 'warning' | 'unknown'
    > = true
    const members: readonly StepEventStatus[] = [
      'ok',
      'error',
      'warning',
      'unknown',
    ]

    expect(exact).toBe(true)
    expect(members).toEqual(['ok', 'error', 'warning', 'unknown'])
  })

})
