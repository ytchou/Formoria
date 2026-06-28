import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/services/mit-registry', () => ({
  syncMitRegistry: vi.fn(),
}));

import { syncMitRegistry } from '@/lib/services/mit-registry';

describe('POST /api/cron/sync-mit-registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ORIGIN_SECRET', 'test-secret');
  });

  it('returns 401 without valid x-origin-verify header', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/cron/sync-mit-registry', {
      method: 'POST',
      headers: {},
    });

    const response = await POST(req);
    expect(response.status).toBe(401);
  });

  it('calls syncMitRegistry and returns 200 on success', async () => {
    vi.mocked(syncMitRegistry).mockResolvedValue({ recordCount: 100, durationMs: 500 });

    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/cron/sync-mit-registry', {
      method: 'POST',
      headers: { 'x-origin-verify': 'test-secret' },
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(syncMitRegistry).toHaveBeenCalledOnce();
  });

  it('returns 500 when sync fails', async () => {
    vi.mocked(syncMitRegistry).mockRejectedValue(new Error('Download failed'));

    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/cron/sync-mit-registry', {
      method: 'POST',
      headers: { 'x-origin-verify': 'test-secret' },
    });

    const response = await POST(req);
    expect(response.status).toBe(500);
  });
});
