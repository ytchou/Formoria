// @vitest-environment node
import { describe, it, expect } from 'vitest';
import Icon from './icon';

describe('icon route', () => {
  it('returns a 200 PNG', async () => {
    const res = await Icon();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
  });
});
