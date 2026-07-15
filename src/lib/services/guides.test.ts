/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tina/client', () => ({
  client: {
    queries: {
      guideConnection: vi.fn(),
      guide: vi.fn(),
    },
  },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import {
  getAllGuides,
  getGuideBySlug,
  getGuidesByCategory,
  getPublishedGuideBySlug,
} from './guides';
import { client } from '@tina/client'
import { notFound } from 'next/navigation';

const mockGuideNode = {
  title: 'Taiwan Skincare Brands',
  description: 'Top skincare brands from Taiwan',
  slug: 'taiwan-skincare-brands',
  category: 'beauty',
  locale: 'zh-TW',
  publishedAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  draft: false,
  sources: ['https://example.com/source'],
  faq: [{ q: 'What makes Taiwan skincare special?', a: 'High-quality ingredients and innovation.' }],
  body: { type: 'root', children: [] },
  _sys: { filename: 'taiwan-skincare-brands.mdx', relativePath: 'taiwan-skincare-brands.mdx' },
};

describe('guides service (Tina-backed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAllGuides', () => {
    it('returns guides with preserved nested frontmatter shape', async () => {
      vi.mocked(client.queries.guideConnection).mockResolvedValue({
        data: {
          guideConnection: {
            edges: [{ node: mockGuideNode }],
          },
        },
      } as any);

      const result = await getAllGuides();
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      const guides = result.guides;

      expect(guides).toHaveLength(1);
      expect(guides[0].slug).toBe('taiwan-skincare-brands');
      expect(guides[0].frontmatter.title).toBe('Taiwan Skincare Brands');
      expect(guides[0].frontmatter.description).toBe('Top skincare brands from Taiwan');
      expect(guides[0].frontmatter.category).toBe('beauty');
      expect(guides[0].frontmatter.locale).toBe('zh-TW');
      expect(guides[0].frontmatter.publishedAt).toBe('2026-06-15T00:00:00.000Z');
      expect(guides[0].frontmatter.faq).toEqual([
        { q: 'What makes Taiwan skincare special?', a: 'High-quality ingredients and innovation.' },
      ]);
      expect(guides[0].frontmatter.sources).toEqual(['https://example.com/source']);
      expect(guides[0].frontmatter.draft).toBe(false);
    });

    it('filters by locale zh-TW and non-draft', async () => {
      vi.mocked(client.queries.guideConnection).mockResolvedValue({
        data: { guideConnection: { edges: [] } },
      } as any);

      await getAllGuides();

      expect(client.queries.guideConnection).toHaveBeenCalledWith({
        first: 200,
        filter: { locale: { eq: 'zh-TW' }, draft: { eq: false } },
      });
    });

    it('handles missing optional fields with defaults', async () => {
      const nodeWithMissing = {
        ...mockGuideNode,
        updatedAt: undefined,
        sources: undefined,
        faq: undefined,
        draft: undefined,
      };
      vi.mocked(client.queries.guideConnection).mockResolvedValue({
        data: { guideConnection: { edges: [{ node: nodeWithMissing }] } },
      } as any);

      const result = await getAllGuides();
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      const guides = result.guides;

      expect(guides[0].frontmatter.updatedAt).toBeUndefined();
      expect(guides[0].frontmatter.sources).toEqual([]);
      expect(guides[0].frontmatter.faq).toEqual([]);
      expect(guides[0].frontmatter.draft).toBe(false);
    });

    it('returns a failure result and logs TinaCMS errors', async () => {
      const error = new Error('TinaCMS unavailable');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(client.queries.guideConnection).mockRejectedValue(error);

      const result = await getAllGuides();

      expect(result).toEqual({ ok: false, error });
      expect(consoleError).toHaveBeenCalledWith(
        '[guides:getAllGuides] TinaCMS query failed',
        error,
      );
      consoleError.mockRestore();
    });
  });

  describe('getGuideBySlug', () => {
    it('returns entry with preserved shape and raw tina result', async () => {
      const tinaResult = {
        data: { guide: mockGuideNode },
        query: 'query { guide { ... } }',
        variables: { relativePath: 'taiwan-skincare-brands.mdx' },
      };
      vi.mocked(client.queries.guide).mockResolvedValue(tinaResult as any);

      const result = await getGuideBySlug('taiwan-skincare-brands');

      expect(result).not.toBeNull();
      if (!result) throw new Error('Expected guide detail result');
      expect(result.entry.slug).toBe('taiwan-skincare-brands');
      expect(result.entry.frontmatter.title).toBe('Taiwan Skincare Brands');
      expect(result.tina).toBe(tinaResult);
    });

    it('returns null when the guide is missing', async () => {
      vi.mocked(client.queries.guide).mockResolvedValue({
        data: { guide: null },
        query: '',
        variables: {},
      } as any);

      const result = await getGuideBySlug('missing-guide');

      expect(result).toBeNull();
      expect(notFound).not.toHaveBeenCalled();
    });

    it('returns null when Tina returns a malformed result', async () => {
      vi.mocked(client.queries.guide).mockResolvedValue(null as any);

      const result = await getGuideBySlug('malformed-guide');

      expect(result).toBeNull();
      expect(notFound).not.toHaveBeenCalled();
    });

    it('returns null when Tina fails to load the guide', async () => {
      vi.mocked(client.queries.guide).mockRejectedValue(new Error('TinaCMS unavailable'));

      const result = await getGuideBySlug('unavailable-guide');

      expect(result).toBeNull();
      expect(notFound).not.toHaveBeenCalled();
    });

    it('queries by relativePath with .mdx extension', async () => {
      vi.mocked(client.queries.guide).mockResolvedValue({
        data: { guide: mockGuideNode },
        query: '',
        variables: {},
      } as any);

      await getGuideBySlug('taiwan-skincare-brands');

      expect(client.queries.guide).toHaveBeenCalledWith({
        relativePath: 'taiwan-skincare-brands.mdx',
      });
    });
  });

  describe('getPublishedGuideBySlug', () => {
    it('does not expose a draft guide through the public query', async () => {
      vi.mocked(client.queries.guide).mockResolvedValue({
        data: { guide: { ...mockGuideNode, draft: true } },
        query: '',
        variables: {},
      } as any);

      await expect(
        getPublishedGuideBySlug('taiwan-skincare-brands'),
      ).resolves.toBeNull();
    });
  });

  describe('getGuidesByCategory', () => {
    it('filters by category, locale, and draft status', async () => {
      vi.mocked(client.queries.guideConnection).mockResolvedValue({
        data: { guideConnection: { edges: [] } },
      } as any);

      await getGuidesByCategory('beauty');

      expect(client.queries.guideConnection).toHaveBeenCalledWith({
        first: 200,
        filter: {
          category: { eq: 'beauty' },
          locale: { eq: 'zh-TW' },
          draft: { eq: false },
        },
      });
    });
  });
});
