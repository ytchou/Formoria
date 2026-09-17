import { describe, expect, it } from 'vitest'

import {
  evaluateDatabaseEvidence,
  type DatabaseEvidence,
} from '../../../../../../scripts/health-agent/directory'

describe('database health detector', () => {
  it('reports saturation, long queries and dead tuples at their registry thresholds, and dead tuples are report_only + human', () => {
    const evidence: DatabaseEvidence = {
      connections: { total: 85, maximum: 100 }, // 85% > 80% threshold
      activeQueries: [
        { queryId: 'pid-1', durationSeconds: 90 }, // > 60s threshold
        { queryId: 'pid-2', durationSeconds: 30 }, // under threshold
      ],
      deadTupleSnapshots: [
        {
          snapshotDate: '2026-09-15',
          tables: [
            {
              tableName: 'big_table',
              deadTuplePercent: 25, // > 20% threshold
              deadTuples: 5000,
              liveTuples: 15000,
              autovacuumThreshold: 3050,
            },
          ],
        },
        {
          snapshotDate: '2026-09-16',
          tables: [
            {
              tableName: 'big_table',
              deadTuplePercent: 22, // > 20% threshold, recurring
              deadTuples: 4400,
              liveTuples: 15600,
              autovacuumThreshold: 3170,
            },
          ],
        },
      ],
      indexConcerns: [],
    }

    const result = evaluateDatabaseEvidence(evidence)

    // Connection saturation finding
    const saturationFinding = result.findings.find(
      (f) => f.fingerprint === 'directory:connection-saturation:database',
    )
    expect(saturationFinding).toBeDefined()
    expect(saturationFinding!.severity).toBe('critical')
    expect(saturationFinding!.mergePolicy).toBe('human')

    // Slow query finding
    const slowQueryFinding = result.findings.find(
      (f) => f.fingerprint === 'directory:active-query:pid-1',
    )
    expect(slowQueryFinding).toBeDefined()
    expect(slowQueryFinding!.severity).toBe('high')

    // No finding for the fast query
    const fastQuery = result.findings.find(
      (f) => f.fingerprint === 'directory:active-query:pid-2',
    )
    expect(fastQuery).toBeUndefined()

    // Dead tuples finding is report_only and human
    const deadTupleFinding = result.findings.find(
      (f) => f.fingerprint === 'directory:dead-tuples:big_table',
    )
    expect(deadTupleFinding).toBeDefined()
    expect(deadTupleFinding!.disposition).toBe('report_only')
    expect(deadTupleFinding!.mergePolicy).toBe('human')
    expect(deadTupleFinding!.severity).toBe('high')
  })

  it('does not report when values are under thresholds', () => {
    const evidence: DatabaseEvidence = {
      connections: { total: 20, maximum: 100 }, // 20% < 80%
      activeQueries: [{ queryId: 'pid-1', durationSeconds: 10 }], // < 60s
      deadTupleSnapshots: [
        {
          snapshotDate: '2026-09-16',
          tables: [
            {
              tableName: 'small_table',
              deadTuplePercent: 5, // < 20%
              deadTuples: 50,
              liveTuples: 950,
              autovacuumThreshold: 240,
            },
          ],
        },
      ],
      indexConcerns: [],
    }

    const result = evaluateDatabaseEvidence(evidence)
    expect(result.findings).toHaveLength(0)
  })
})
