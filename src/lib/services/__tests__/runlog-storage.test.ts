import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadPrivateFile } from '@/lib/services/image-upload'
import { getRunLogSnapshotUrl, uploadRunLogSnapshot } from '@/lib/services/runlog-storage'

const mocks = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
}))

vi.mock('@/lib/services/image-upload', () => ({ uploadPrivateFile: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    storage: { from: () => ({ createSignedUrl: mocks.createSignedUrl }) },
  }),
}))

describe('runlog storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(uploadPrivateFile).mockResolvedValue({ key: 'run-logs/job-1.html' })
    mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example/runlog' }, error: null })
  })

  it('uploads an upserted self-contained HTML snapshot', async () => {
    await uploadRunLogSnapshot('job-1', '<!doctype html><title>Enrich run</title>')

    expect(uploadPrivateFile).toHaveBeenCalledWith({
      bucket: 'run-logs',
      path: 'job-1.html',
      data: Buffer.from('<!doctype html><title>Enrich run</title>'),
      contentType: 'text/html; charset=utf-8',
      upsert: true,
    })
  })

  it('returns a one-hour signed URL', async () => {
    await expect(getRunLogSnapshotUrl('job-1')).resolves.toBe('https://storage.example/runlog')
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('job-1.html', 3600)
  })

  it('returns null when the snapshot is not found', async () => {
    mocks.createSignedUrl.mockResolvedValue({
      data: null,
      error: { statusCode: '404', message: 'Object not found' },
    })

    await expect(getRunLogSnapshotUrl('job-missing')).resolves.toBeNull()
  })
})
