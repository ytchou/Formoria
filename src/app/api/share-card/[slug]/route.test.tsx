// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/brands', () => ({
  getBrandBySlug: vi.fn(),
  findBrandByOldSlug: vi.fn(),
}));

import { GET } from './route';
import { findBrandByOldSlug, getBrandBySlug } from '@/lib/services/brands';
import { NotFoundError } from '@/lib/errors';

const approvedBrand = {
  id: 'b-1',
  name: '鮮乳坊',
  slug: 'yu-cha-ye',
  status: 'approved',
  updatedAt: '2026-07-01T00:00:00Z',
};

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/share-card/[slug]', () => {
  it('returns a PNG with overridden cache headers for an approved brand', async () => {
    vi.mocked(getBrandBySlug).mockResolvedValue(approvedBrand as never);
    const res = await GET(new Request('https://formoria.com/api/share-card/yu-cha-ye'), ctx('yu-cha-ye'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    expect(res.headers.get('cache-control')).toContain('s-maxage=86400');
    expect(res.headers.get('content-disposition')).toBeNull();
  });

  it('sets Content-Disposition attachment with ?download=1', async () => {
    vi.mocked(getBrandBySlug).mockResolvedValue(approvedBrand as never);
    const res = await GET(
      new Request('https://formoria.com/api/share-card/yu-cha-ye?download=1'),
      ctx('yu-cha-ye'),
    );
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('formoria-yu-cha-ye.png');
  });

  it('404s for a hidden brand (no name leak)', async () => {
    vi.mocked(getBrandBySlug).mockResolvedValue({ ...approvedBrand, status: 'hidden' } as never);
    const res = await GET(new Request('https://formoria.com/api/share-card/yu-cha-ye'), ctx('yu-cha-ye'));
    expect(res.status).toBe(404);
  });

  it('404s for an unknown slug with no redirect', async () => {
    // getBrandBySlug throws NotFoundError on miss (never returns null)
    vi.mocked(getBrandBySlug).mockRejectedValue(new NotFoundError('Brand', 'nope'));
    vi.mocked(findBrandByOldSlug).mockResolvedValue(null);
    const res = await GET(new Request('https://formoria.com/api/share-card/nope'), ctx('nope'));
    expect(res.status).toBe(404);
  });

  it('302-redirects a renamed slug to the new card URL', async () => {
    // getBrandBySlug throws NotFoundError; findBrandByOldSlug returns the new slug string
    vi.mocked(getBrandBySlug).mockRejectedValue(new NotFoundError('Brand', 'old-slug'));
    vi.mocked(findBrandByOldSlug).mockResolvedValue('new-slug');
    const res = await GET(new Request('https://formoria.com/api/share-card/old-slug'), ctx('old-slug'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/api/share-card/new-slug');
  });
});
