// @vitest-environment node
import { describe, it, expect } from 'vitest';
import Image from './opengraph-image';

describe('opengraph-image route', () => {
  it('returns a 1200x630 PNG', async () => {
    const res = await Image();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
  });
});
