import { describe, expect, it } from 'vitest';
import {
  buildBadgeEmbedSnippet,
  buildShareCardUrl,
  scaleCardNameFontSize,
} from '@/lib/growth/share-assets';

const SITE = 'https://formoria.com';

describe('buildShareCardUrl', () => {
  it('builds the card URL from site + slug', () => {
    expect(buildShareCardUrl(SITE, 'yu-cha-ye')).toBe(
      'https://formoria.com/api/share-card/yu-cha-ye',
    );
  });

  it('appends the download flag', () => {
    expect(buildShareCardUrl(SITE, 'yu-cha-ye', { download: true })).toBe(
      'https://formoria.com/api/share-card/yu-cha-ye?download=1',
    );
  });
});

describe('buildBadgeEmbedSnippet', () => {
  it('emits a dofollow anchor with the 4-param UTM scheme and a fixed-dimension img', () => {
    const snippet = buildBadgeEmbedSnippet(SITE, 'yu-cha-ye');
    expect(snippet).toContain(
      'href="https://formoria.com/brands/yu-cha-ye?utm_source=badge&utm_medium=referral&utm_campaign=featured_badge&utm_content=yu-cha-ye"',
    );
    expect(snippet).toContain('src="https://formoria.com/badges/featured-on-formoria.svg"');
    expect(snippet).toContain('width="200"');
    expect(snippet).toContain('height="56"');
    expect(snippet).not.toContain('rel=');
    expect(snippet).not.toContain('target=');
  });

  it('percent-encodes CJK slugs in both the href path and utm_content', () => {
    const snippet = buildBadgeEmbedSnippet(SITE, '台灣茶葉');
    const encoded = encodeURIComponent('台灣茶葉');
    expect(snippet).toContain(
      `href="${SITE}/brands/${encoded}?utm_source=badge&utm_medium=referral&utm_campaign=featured_badge&utm_content=${encoded}"`,
    );
  });
});

describe('scaleCardNameFontSize', () => {
  it('uses the max size for short CJK names', () => {
    expect(scaleCardNameFontSize('鮮乳坊')).toBe(96);
  });

  it('scales down for long CJK names (20 chars)', () => {
    expect(scaleCardNameFontSize('這是一個非常非常長的台灣品牌名稱測試用例')).toBeLessThanOrEqual(56);
  });

  it('never goes below the floor', () => {
    expect(
      scaleCardNameFontSize('超'.repeat(60)),
    ).toBeGreaterThanOrEqual(40);
  });
});
