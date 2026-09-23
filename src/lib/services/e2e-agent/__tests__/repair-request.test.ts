import { describe, expect, it } from 'vitest'

import {
  buildE2eRepairRequest,
  MAX_ERROR_CHARS,
} from '../repair-request'
import { freezeFailures } from '../freeze'
import {
  buildRepairTriggerMessage,
} from '@/lib/services/health-agent/report'
import { extractRepairRequest } from '@/lib/services/ops-agent/repair'

const baseInput = {
  runId: 'run-e2e-1',
  stagingSha: 'abc1234def',
}

describe('buildE2eRepairRequest', () => {
  it('builds one high-severity e2e finding per frozen failure', () => {
    const request = buildE2eRepairRequest({
      ...baseInput,
      failures: [
        {
          file: 'e2e/tests/brands.spec.ts',
          title: 'brand page loads',
          project: 'deep',
          error: 'Element not found',
        },
        // Duplicate — freeze dedupes it
        {
          file: 'e2e/tests/brands.spec.ts',
          title: 'brand page loads',
          project: 'deep',
          error: 'Element not found',
        },
        {
          file: 'e2e/tests/brands.spec.ts',
          title: 'brand filter works',
          error: 'Timeout',
        },
      ],
      unexpectedSkips: [],
    })

    expect(request).not.toBeNull()
    expect(request!.agent).toBe('e2e-agent')
    expect(request!.ref).toBe('staging')
    expect(request!.runId).toBe('run-e2e-1')
    expect(request!.scope).toEqual(['e2e/tests/brands.spec.ts'])
    expect(request!.findings).toHaveLength(2)

    const frozen = freezeFailures({
      failures: [
        {
          file: 'e2e/tests/brands.spec.ts',
          title: 'brand page loads',
          project: 'deep',
        },
      ],
    })
    const finding = request!.findings.find(
      (f) => f.title === 'brand page loads',
    )
    expect(finding).toEqual({
      fingerprint: frozen.failures[0].id,
      title: 'brand page loads',
      severity: 'high',
      source: 'e2e',
      evidence: {
        file: 'e2e/tests/brands.spec.ts',
        project: 'deep',
        error: 'Element not found',
        kind: 'failure',
        stagingSha: 'abc1234def',
      },
    })

    // Missing project defaults to the runner's only project
    const filter = request!.findings.find(
      (f) => f.title === 'brand filter works',
    )
    expect(filter!.evidence).toMatchObject({ project: 'deep' })
  })

  it('maps unexpected skips to kind unexpected_skip', () => {
    const request = buildE2eRepairRequest({
      ...baseInput,
      failures: [],
      unexpectedSkips: [
        {
          file: 'e2e/tests/auth-password-reset.spec.ts',
          title: 'unexpected auth skip',
          project: 'deep',
        },
      ],
    })

    expect(request!.scope).toEqual(['e2e/tests/auth-password-reset.spec.ts'])
    expect(request!.findings).toHaveLength(1)
    expect(request!.findings[0].evidence).toMatchObject({
      file: 'e2e/tests/auth-password-reset.spec.ts',
      project: 'deep',
      kind: 'unexpected_skip',
      error: expect.stringContaining('skipped'),
    })
  })

  it('truncates each error and strips code fences', () => {
    const longError = '```\n' + 'x'.repeat(MAX_ERROR_CHARS * 2)
    const request = buildE2eRepairRequest({
      ...baseInput,
      failures: [
        { file: 'e2e/tests/a.spec.ts', title: 'a', error: longError },
      ],
      unexpectedSkips: [],
    })

    const error = request!.findings[0].evidence!.error as string
    expect(error.length).toBeLessThanOrEqual(MAX_ERROR_CHARS + 20)
    expect(error).toContain('[truncated]')
    expect(error).not.toContain('```')
  })

  it('returns null when there is nothing to repair', () => {
    expect(
      buildE2eRepairRequest({ ...baseInput, failures: [], unexpectedSkips: [] }),
    ).toBeNull()
  })

  it('round-trips through the ops agent parser', () => {
    const request = buildE2eRepairRequest({
      ...baseInput,
      failures: [
        {
          file: 'e2e/tests/a.spec.ts',
          title: 'a fails',
          project: 'deep',
          error: 'expect(locator).toHaveText("x")\n```\nstack',
        },
        { file: null, title: 'global setup failed', error: 'boom' },
      ],
      unexpectedSkips: [
        { file: 'e2e/tests/b.spec.ts', title: 'b skipped', project: 'deep' },
      ],
    })

    const text = buildRepairTriggerMessage('U_OPS_BOT', request!, 'E2E Agent')
    expect(text.startsWith('<@U_OPS_BOT> E2E Agent repair request')).toBe(true)
    expect(extractRepairRequest(text)).toEqual(request)
  })
})
