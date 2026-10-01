import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAuditEmitterForTests, setAuditWriteSeam } from '@/lib/audit'
import { dispatchCurationJob } from '../curation-dispatch'

const JOB_ID = '550e8400-e29b-41d4-a716-446655440000'

function lookupResponse(): Response {
  return Response.json({
    data: {
      environment: {
        serviceInstances: {
          edges: [{ node: { id: 'si-curation-worker', serviceName: 'curation-worker' } }],
        },
      },
    },
  })
}

describe('dispatchCurationJob', () => {
  beforeEach(() => {
    setAuditWriteSeam(async () => null)
    vi.stubEnv('OPS_AGENT_RAILWAY_TOKEN', 'rw_test_token')
    vi.stubEnv('FORMORIA_DEPLOYMENT_ENV', 'production')
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production')
    vi.stubEnv('NEXT_PUBLIC_DEPLOYMENT_ENV', 'production')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    resetAuditEmitterForTests()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('dispatchCurationJob_requests_a_worker_run_via_railway', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(lookupResponse())
      .mockResolvedValueOnce(Response.json({ data: { deploymentInstanceExecutionCreate: true } }))

    await expect(dispatchCurationJob(JOB_ID)).resolves.toBeUndefined()

    expect(fetch).toHaveBeenCalledTimes(2)
    const mutation = JSON.parse(vi.mocked(fetch).mock.calls[1]![1]!.body as string) as {
      query: string
      variables: { input: unknown }
    }
    expect(mutation.query).toContain('deploymentInstanceExecutionCreate')
    expect(mutation.variables.input).toEqual({ serviceInstanceId: 'si-curation-worker' })
  })

  it('dispatchCurationJob_throws_when_railway_refuses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        errors: [{ message: 'Bearer provider-secret rejected' }],
      }),
    )

    await expect(dispatchCurationJob(JOB_ID)).rejects.toThrow(
      'Worker run request failed: Bearer [REDACTED] rejected',
    )
  })

  it('dispatchCurationJob_refuses_in_staging', async () => {
    vi.stubEnv('FORMORIA_DEPLOYMENT_ENV', 'staging')

    await expect(dispatchCurationJob(JOB_ID)).rejects.toThrow('production only')
    expect(fetch).not.toHaveBeenCalled()
  })
})
