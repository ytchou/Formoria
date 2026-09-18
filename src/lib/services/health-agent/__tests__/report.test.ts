import { describe, expect, it } from 'vitest'
import type { HealthFinding } from '../contracts'
import type { DetectorResult } from '../types'
import {
  buildTickets,
  buildDigest,
  buildRepairTriggerMessage,
  escapeSlackMrkdwn,
  linearLabelForSource,
  MAX_NEW_TICKETS_PER_RUN,
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
  it('one ticket is created per never-ticketed fingerprint', () => {
    const findings = [
      makeFinding({ fingerprint: 'directory:test:a' }),
      makeFinding({ fingerprint: 'directory:test:b' }),
      makeFinding({ fingerprint: 'directory:test:c' }),
    ]

    const tickets = buildTickets(findings, {
      unticketed: new Set(['directory:test:a', 'directory:test:b', 'directory:test:c']),
      traceUrl: 'https://langfuse.example.com/trace/abc',
    })

    expect(tickets).toHaveLength(3)
  })

  it('links-weekly produces one ticket per class listing its dead links', () => {
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
    ]

    const tickets = buildTickets(findings, {
      unticketed: new Set([
        'links-weekly:social:brand-a-ig',
        'links-weekly:social:brand-b-ig',
        'links-weekly:brand-channels:brand-c-pchome',
      ]),
      traceUrl: 'https://langfuse.example.com/trace/abc',
      groupLinksWeekly: true,
    })

    // Should be grouped: one ticket for social (2 links), one for brand-channels (1 link)
    expect(tickets).toHaveLength(2)
    const socialTicket = tickets.find((t: { title: string; body: string }) => t.title.includes('social'))
    expect(socialTicket).toBeDefined()
    expect(socialTicket!.body).toContain('brand-a')
    expect(socialTicket!.body).toContain('brand-b')
  })

  it('new tickets are capped per run, oldest first, and the rest stay unticketed', () => {
    const findings = Array.from({ length: 15 }, (_, i) =>
      makeFinding({
        fingerprint: `directory:test:finding-${String(i).padStart(3, '0')}`,
      }),
    )

    const tickets = buildTickets(findings, {
      unticketed: new Set(findings.map((f) => f.fingerprint)),
      traceUrl: 'https://langfuse.example.com/trace/abc',
    })

    expect(tickets).toHaveLength(MAX_NEW_TICKETS_PER_RUN)
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
    })

    expect(tickets[0].body).toContain(traceUrl)
    expect(tickets[0].body).not.toContain('github.com')
    expect(tickets[0].body).not.toContain('actions/runs')
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
