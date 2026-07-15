import { describe, expect, it } from 'vitest'
import { coerceRunLog } from './normalize'

describe('coerceRunLog', () => {
  it('coerces a valid runlog unchanged in essentials', () => {
    const input = {
      schemaVersion: '1.0',
      run: { id: 'job-1', workflow: 'enrich', status: 'completed' },
      summary: { phaseCount: 1, tokens: { input: 100, output: 40, total: 140 } },
      phases: [
        {
          index: 1,
          name: 'detect',
          kind: 'llm',
          status: 'succeeded',
          events: [
            {
              actor: 'LLM',
              summary: 'detect batch',
              status: 'ok',
              model: 'deepseek-v4-flash',
              tokens: { input: 100, output: 40 },
              latencyMs: 812,
            },
          ],
        },
      ],
      provenance: { producer: { name: 'formoria-tests' }, generatedAt: '2026-07-15T00:00:00Z' },
    }

    const out = coerceRunLog(input)

    expect(out.run.id).toBe('job-1')
    expect(out.phases[0]?.events[0]?.tokens?.input).toBe(100)
    expect(out.gaps ?? []).toHaveLength(0)
  })

  it.each([null, undefined, 42, 'nope', {}, { run: null }, { phases: 'bad' }])(
    'never throws and records gaps for garbage input %#',
    (garbage) => {
      const out = coerceRunLog(garbage)

      expect(out.run.status).toBe('unknown')
      expect(out.phases).toEqual([])
      expect((out.gaps ?? []).length).toBeGreaterThan(0)
    },
  )

  it('coerces unknown actor/status values to safe fallbacks', () => {
    const out = coerceRunLog({
      run: { id: 'job-2', workflow: 'enrich', status: 'exploded' },
      phases: [{ name: 'detect', status: 'weird', events: [{ actor: 'ALIEN', summary: 'detected' }] }],
    })

    expect(out.run.status).toBe('unknown')
    expect(out.phases[0]?.status).toBe('unknown')
    expect(out.phases[0]?.events[0]?.actor).toBe('SYSTEM')
  })
})
