import { describe, it, expect } from 'vitest';
import { client } from './client';

describe('tina filesystem client', () => {
  it('guideConnection returns edges for real content files', async () => {
    const result = await client.queries.guideConnection();
    // content/guides/ has at least taiwan-skincare-brands.mdx
    expect(result.data.guideConnection.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('guideConnection filters by locale', async () => {
    const result = await client.queries.guideConnection({
      filter: { locale: { eq: 'zh-TW' }, draft: { eq: false } },
    });
    for (const edge of result.data.guideConnection.edges) {
      expect(edge?.node.locale).toBe('zh-TW');
      expect(edge?.node.draft).toBe(false);
    }
  });

  it('guide returns frontmatter fields for a known file', async () => {
    const result = await client.queries.guide({ relativePath: 'taiwan-skincare-brands.mdx' });
    expect(result.data.guide.title).toBeTruthy();
    expect(result.data.guide.slug).toBe('taiwan-skincare-brands');
    expect(result.data.guide.body).toBeTruthy();
    expect(result).toHaveProperty('query');
    expect(result).toHaveProperty('variables');
  });

  it('guide returns empty object for missing file', async () => {
    const result = await client.queries.guide({ relativePath: 'nonexistent.mdx' });
    expect(result.data.guide).toEqual({});
  });
});
