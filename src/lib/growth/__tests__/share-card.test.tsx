import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderShareCard, shareCardHeadline } from '@/lib/growth/share-card';

const BRAND = { name: '雨茶葉', slug: 'yu-cha-ye' };
const MARK = 'data:image/png;base64,AAAA';

function render(locale: string): string {
  return renderToStaticMarkup(renderShareCard(BRAND, MARK, locale));
}

describe('renderShareCard headline', () => {
  it('renders the zh-TW headline for zh-TW', () => {
    expect(render('zh-TW')).toContain('我們的品牌收錄在 Formoria');
  });

  it('renders the English headline for en', () => {
    const html = render('en');
    expect(html).toContain('Our brand is listed on Formoria');
    expect(html).not.toContain('我們的品牌收錄在 Formoria');
  });

  it('falls back to the zh-TW headline for an unsupported locale', () => {
    expect(render('fr')).toContain('我們的品牌收錄在 Formoria');
    expect(shareCardHeadline('fr')).toBe(shareCardHeadline('zh-TW'));
  });

  it.each(['zh-TW', 'en', 'fr'])('never says 上架 (%s)', (locale) => {
    expect(render(locale)).not.toContain('上架');
  });
});
