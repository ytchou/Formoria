// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/services/taxonomy', () => ({
  getTags: vi.fn().mockResolvedValue([
    { slug: 'apparel', name: 'Apparel', nameZh: '服飾' },
  ]),
}));

vi.mock('@/lib/services/brands', () => ({
  getBrands: vi.fn().mockResolvedValue({ totalCount: 12 }),
}));

import Image from './opengraph-image';

describe('category opengraph-image route', () => {
  it('returns a 1200x630 PNG for a category', async () => {
    const res = await Image({ params: Promise.resolve({ category: 'apparel' }) } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
  });
});
