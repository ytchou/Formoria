import { describe, expect, it } from 'vitest'
import type { HealthFinding } from '../contracts'
import type { DetectorResult } from '../types'
import {
  buildTickets,
  buildDigest,
  buildRepairTriggerMessage,
  escapeSlackMrkdwn,
  linearLabelForSource,
} from '../report'
import type { RepairRequest } from '../repair-request'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<HealthFinding> = {}): HealthFinding {
  return {
    source: 'directory',
    fingerprint: `directory:test:${Math.random()}`,
    title: 'Test finding',
    severity: 'medium',
    evidence: {},
    mergePolicy: 'human',
    ...overrides,
  }
}

function makeResult(
  overrides: Partial<DetectorResult> & { name: DetectorResult['name'] },
): DetectorResult {
  return {
    source: 'directory',
    status: 'ok',
    findings: [],
    durationMs: 100,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('report — tickets', () => {
  it('one ticket carries every never-ticketed finding from the run', () => {
    const findings = [
      makeFinding({
        fingerprint: 'directory:test:a',
        title: 'Missing category',
      }),
      makeFinding({
        source: 'credential',
        fingerprint: 'credential:test:b',
        title: 'Resend authentication failed',
      }),
      makeFinding({
        source: 'quality',
        fingerprint: 'quality:test:c',
        title: 'Vitest failed',
      }),
      ...Array.from({ length: 9 }, (_, index) =>
        makeFinding({
          fingerprint: `directory:test:extra-${index}`,
          title: `Additional finding ${index}`,
        }),
      ),
    ]

    const tickets = buildTickets(findings, {
      unticketed: new Set(findings.map((finding) => finding.fingerprint)),
      traceUrl: 'https://langfuse.example.com/trace/abc',
      date: '2026-09-20',
    })

    expect(tickets).toHaveLength(1)
    expect(tickets[0].title).toBe('Health Agent — 12 new findings (2026-09-20)')
    expect(tickets[0].fingerprints).toEqual(
      findings.map((finding) => finding.fingerprint),
    )
    expect(tickets[0].body).toContain('Missing category')
    expect(tickets[0].body).toContain('Resend authentication failed')
    expect(tickets[0].body).toContain('Vitest failed')
    expect(tickets[0].body).toContain('Additional finding 8')
    expect(tickets[0].labels).toEqual(['Data Quality', 'Ops'])
  })

  it('links-weekly findings share the run ticket with every other finding', () => {
    const findings = [
      makeFinding({
        source: 'links-weekly',
        fingerprint: 'links-weekly:social:brand-a-ig',
        title: 'Dead social link: brand-a IG',
      }),
      makeFinding({
        source: 'links-weekly',
        fingerprint: 'links-weekly:social:brand-b-ig',
        title: 'Dead social link: brand-b IG',
      }),
      makeFinding({
        source: 'links-weekly',
        fingerprint: 'links-weekly:brand-channels:brand-c-pchome',
        title: 'Dead channel link: brand-c PChome',
      }),
      makeFinding({
        fingerprint: 'directory:test:brand-d',
        title: 'Brand D is missing its category',
      }),
    ]

    const tickets = buildTickets(findings, {
      unticketed: new Set([
        'links-weekly:social:brand-a-ig',
        'links-weekly:social:brand-b-ig',
        'links-weekly:brand-channels:brand-c-pchome',
        'directory:test:brand-d',
      ]),
      traceUrl: 'https://langfuse.example.com/trace/abc',
      date: '2026-09-20',
    })

    expect(tickets).toHaveLength(1)
    expect(tickets[0].body).toContain('brand-a')
    expect(tickets[0].body).toContain('brand-b')
    expect(tickets[0].body).toContain('brand-c')
    expect(tickets[0].body).toContain('Brand D is missing its category')
  })

  it('an investigator diagnosis is appended to its finding ticket body', () => {
    const findings = [
      makeFinding({
        fingerprint: 'directory:test:a',
        evidence: { diagnosis: 'The brand was deleted from the CMS' },
      }),
    ]

    const tickets = buildTickets(findings, {
      unticketed: new Set(['directory:test:a']),
      traceUrl: 'https://langfuse.example.com/trace/abc',
      date: '2026-09-20',
      investigations: new Map([
        ['directory:test:a', 'Root cause: brand was removed from CMS on 2026-09-15'],
      ]),
    })

    expect(tickets).toHaveLength(1)
    expect(tickets[0].body).toContain('Root cause: brand was removed from CMS')
  })

  it('ticket bodies and the digest link to the Langfuse trace, never a GitHub Actions run URL', () => {
    const findings = [makeFinding({ fingerprint: 'directory:test:a' })]
    const traceUrl = 'https://cloud.langfuse.com/project/abc/traces/xyz'

    const tickets = buildTickets(findings, {
      unticketed: new Set(['directory:test:a']),
      traceUrl,
      date: '2026-09-20',
    })

    expect(tickets[0].body).toContain(traceUrl)
    expect(tickets[0].body).not.toContain('github.com')
    expect(tickets[0].body).not.toContain('actions/runs')
  })

  it('suppresses only Sentry runtime findings from Linear', () => {
    const sentry = makeFinding({
      source: 'sentry',
      fingerprint: 'sentry:issue:123456',
    })
    const captureCredential = makeFinding({
      source: 'credential',
      fingerprint: 'credential:sentry-capture:round-trip',
    })

    const tickets = buildTickets([sentry, captureCredential], {
      unticketed: new Set([sentry.fingerprint, captureCredential.fingerprint]),
      traceUrl: 'https://langfuse.example.com/trace/abc',
      date: '2026-09-20',
    })

    expect(tickets).toHaveLength(1)
    expect(tickets[0].fingerprints).toEqual([captureCredential.fingerprint])
    expect(tickets[0].labels).toEqual(['Ops'])
  })
})

describe('report — digest', () => {
  it('lists per-source counts and names every detector that could not run', () => {
    const results: DetectorResult[] = [
      makeResult({
        name: 'brand-invariants',
        source: 'directory',
        status: 'ok',
        findings: [makeFinding(), makeFinding()],
      }),
      makeResult({
        name: 'sentry-triage',
        source: 'sentry',
        status: 'failed',
        error: 'connection timeout',
      }),
    ]

    const digest = buildDigest(results, {
      date: '2026-09-17',
      traceUrl: 'https://langfuse.example.com/trace/abc',
    })

    expect(digest).toContain('directory')
    expect(digest).toContain('2') // 2 findings from directory
    expect(digest).toContain('sentry-triage')
    expect(digest).toContain('could not run')
    expect(digest).toContain('langfuse.example.com')
    expect(digest).not.toContain('github.com')
  })

  it('digest is posted even when there are zero findings', () => {
    const results: DetectorResult[] = [
      makeResult({
        name: 'brand-invariants',
        source: 'directory',
        status: 'ok',
        findings: [],
      }),
    ]

    const digest = buildDigest(results, {
      date: '2026-09-17',
      traceUrl: 'https://langfuse.example.com/trace/abc',
    })

    // Should still produce a non-empty digest
    expect(digest.length).toBeGreaterThan(0)
    expect(digest).toContain('0')
  })

  it('keeps the active Sentry count and prioritizes at most ten new or returned issues', () => {
    const sentryFindings = Array.from({ length: 13 }, (_, index) =>
      makeFinding({
        source: 'sentry',
        fingerprint: `sentry:issue:${index}`,
        sentryIssueId: String(index),
        title: index === 12
          ? 'Existing active issue'
          : `Runtime issue ${String(index).padStart(2, '0')}`,
        severity: index === 11 ? 'critical' : index === 10 ? 'high' : 'medium',
        evidence: {
          userCount: index,
          lastSeen: `2026-09-19T${String(index).padStart(2, '0')}:00:00Z`,
        },
      }),
    )
    const highlightedFingerprints = new Set(
      sentryFindings.slice(0, 12).map((finding) => finding.fingerprint),
    )

    const digest = buildDigest([
      makeResult({
        name: 'sentry-triage',
        source: 'sentry',
        findings: sentryFindings,
      }),
    ], {
      date: '2026-09-19',
      traceUrl: 'https://langfuse.example.com/trace/abc',
      highlightedFingerprints,
    })

    expect(digest).toContain('Sentry active: 13')
    expect(digest).toContain('New or returned Sentry issues:')
    expect(digest.indexOf('Runtime issue 11')).toBeLessThan(
      digest.indexOf('Runtime issue 10'),
    )
    expect(digest).toContain('2 more new or returned Sentry issues')
    expect(digest).not.toContain('Runtime issue 00')
    expect(digest).not.toContain('Runtime issue 01')
    expect(digest).not.toContain('Existing active issue')
  })

  it('digest shows rootCause for highlighted sentry findings', () => {
    const finding = makeFinding({
      source: 'sentry',
      fingerprint: 'sentry:issue:rc-1',
      sentryIssueId: '99001',
      title: 'Null pointer in cart',
      severity: 'medium',
      evidence: {
        rootCause: 'Missing null check in cart handler',
        userCount: 5,
        lastSeen: '2026-09-20T10:00:00Z',
      },
    })

    const digest = buildDigest(
      [
        makeResult({
          name: 'sentry-triage',
          source: 'sentry',
          findings: [finding],
        }),
      ],
      {
        date: '2026-09-20',
        traceUrl: 'https://langfuse.example.com/trace/rc',
        highlightedFingerprints: new Set([finding.fingerprint]),
      },
    )

    expect(digest).toContain(
      '[medium] Null pointer in cart — Missing null check in cart handler',
    )
  })

  it('digest truncates a long rootCause at 120 characters', () => {
    const longCause = 'A'.repeat(500)
    const finding = makeFinding({
      source: 'sentry',
      fingerprint: 'sentry:issue:long-rc',
      sentryIssueId: '99003',
      title: 'Long root cause issue',
      severity: 'medium',
      evidence: {
        rootCause: longCause,
        userCount: 2,
        lastSeen: '2026-09-20T12:00:00Z',
      },
    })

    const digest = buildDigest(
      [
        makeResult({
          name: 'sentry-triage',
          source: 'sentry',
          findings: [finding],
        }),
      ],
      {
        date: '2026-09-20',
        traceUrl: 'https://langfuse.example.com/trace/long-rc',
        highlightedFingerprints: new Set([finding.fingerprint]),
      },
    )

    // The full 500-char rootCause should NOT appear
    expect(digest).not.toContain(longCause)
    // Should contain the truncated version (120 chars + ellipsis)
    expect(digest).toContain('A'.repeat(120) + '…')
  })

  it('digest omits rootCause suffix when absent', () => {
    const finding = makeFinding({
      source: 'sentry',
      fingerprint: 'sentry:issue:no-rc',
      sentryIssueId: '99002',
      title: 'Timeout in API',
      severity: 'high',
      evidence: {
        userCount: 3,
        lastSeen: '2026-09-20T11:00:00Z',
      },
    })

    const digest = buildDigest(
      [
        makeResult({
          name: 'sentry-triage',
          source: 'sentry',
          findings: [finding],
        }),
      ],
      {
        date: '2026-09-20',
        traceUrl: 'https://langfuse.example.com/trace/no-rc',
        highlightedFingerprints: new Set([finding.fingerprint]),
      },
    )

    expect(digest).toContain('[high] Timeout in API')
    const findingLine = digest.split('\n').find((l) => l.includes('[high] Timeout in API'))
    expect(findingLine).toBe('  [high] Timeout in API')
  })
})

describe('report — repair trigger message', () => {
  it('buildRepairTriggerMessage formats human summary + JSON', () => {
    const request: RepairRequest = {
      agent: 'ops-agent',
      ref: 'staging',
      runId: 'run-123',
      traceUrl: 'https://cloud.langfuse.com/trace/run-123',
      scope: ['src/lib/services/test.ts'],
      findings: [
        {
          fingerprint: 'quality:vitest-failure:broken test',
          title: 'Test failure: broken test',
          severity: 'high',
          source: 'quality',
        },
        {
          fingerprint: 'quality:vitest-failure:another test',
          title: 'Test failure: another test',
          severity: 'high',
          source: 'quality',
        },
      ],
    }

    const message = buildRepairTriggerMessage('U_BOT_ID', request)

    expect(message).toContain('<@U_BOT_ID>')
    expect(message).toContain('Test failure: broken test')
    expect(message).toContain('Test failure: another test')
    expect(message).toContain('```')
  })

  it('buildRepairTriggerMessage JSON block is valid RepairRequest', () => {
    const request: RepairRequest = {
      agent: 'ops-agent',
      ref: 'staging',
      runId: 'run-456',
      scope: ['file.ts'],
      findings: [
        {
          fingerprint: 'quality:vitest-failure:test',
          title: 'Test failure',
          severity: 'high',
          source: 'quality',
        },
      ],
    }

    const message = buildRepairTriggerMessage('U_BOT', request)

    // Extract JSON from the code block
    const codeBlockMatch = message.match(/```json\n([\s\S]*?)\n```/)
    expect(codeBlockMatch).not.toBeNull()

    const parsed = JSON.parse(codeBlockMatch![1])
    expect(parsed.agent).toBe('ops-agent')
    expect(parsed.ref).toBe('staging')
    expect(parsed.findings).toHaveLength(1)
    expect(parsed.scope).toEqual(['file.ts'])
  })
})

describe('report — escapeSlackMrkdwn', () => {
  it('escapes &, <, and > for Slack mrkdwn', () => {
    expect(escapeSlackMrkdwn('<Component>')).toBe('&lt;Component&gt;')
    expect(escapeSlackMrkdwn('<@U12345>')).toBe('&lt;@U12345&gt;')
    expect(escapeSlackMrkdwn('a & b')).toBe('a &amp; b')
    expect(escapeSlackMrkdwn('no special chars')).toBe('no special chars')
  })

  it('buildRepairTriggerMessage escapes finding titles', () => {
    const request: RepairRequest = {
      agent: 'ops-agent',
      ref: 'staging',
      runId: 'run-esc',
      scope: ['file.ts'],
      findings: [
        {
          fingerprint: 'quality:vitest-failure:<Component>',
          title: 'Test failure: <Component> & stuff',
          severity: 'high',
          source: 'quality',
        },
      ],
    }

    const message = buildRepairTriggerMessage('U_BOT', request)

    // The human-readable summary line should have escaped title
    expect(message).toContain('&lt;Component&gt; &amp; stuff')
    // The raw title should NOT appear unescaped in the summary lines
    // (it will still appear unescaped inside the JSON code block, which is expected)
    const summaryLines = message.split('```')[0]
    expect(summaryLines).not.toContain('<Component>')
  })
})

describe('report — labels', () => {
  it('label is Ops for sentry and credential sources and Data Quality otherwise', () => {
    expect(linearLabelForSource('sentry')).toBe('Ops')
    expect(linearLabelForSource('credential')).toBe('Ops')
    expect(linearLabelForSource('directory')).toBe('Data Quality')
    expect(linearLabelForSource('link')).toBe('Data Quality')
    expect(linearLabelForSource('quality')).toBe('Data Quality')
    expect(linearLabelForSource('pipeline')).toBe('Data Quality')
    expect(linearLabelForSource('surface')).toBe('Data Quality')
    expect(linearLabelForSource('links-weekly')).toBe('Data Quality')
  })
})
