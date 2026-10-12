import { describe, expect, it } from 'vitest';
import { scaleCardNameFontSize } from '@/lib/growth/share-assets';

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
