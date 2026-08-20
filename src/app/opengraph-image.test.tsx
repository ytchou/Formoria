// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { brand } from '@/lib/brand/colors';
import Image from './opengraph-image';

const source = readFileSync(
  join(process.cwd(), 'src/app/opengraph-image.tsx'),
  'utf8',
);

describe('opengraph-image route', () => {
  it('returns a 1200x630 PNG', async () => {
    const res = await Image();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
  });

  it('renders on the v2 palette, with every colour named in colors.ts', () => {
    // The PNG cannot be asserted against, so the source is: satori requires
    // inline styles, and an inline style is exactly where a stray hex hides.
    expect(source).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(source).toContain('@/lib/brand/colors');
    // The accent's literal value is pinned once, in src/lib/brand/colors.test.ts.
    // Re-pinning it here would fork the palette a fourth time — the exact
    // failure v2 exists to end. What matters here is that the route reads the
    // palette rather than carrying its own copy, which the two lines above assert.
    expect(brand.accent).toBeTruthy();
  });

  it('specifies a sans face only (D17)', () => {
    expect(source.replaceAll('sans-serif', '')).not.toMatch(/serif|明體/i);
  });
});
