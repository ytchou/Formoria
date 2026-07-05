import { describe, it, expect } from 'vitest';
import { client } from './client';

describe('tina client stub', () => {
  it('guideConnection does not throw and returns empty edges', async () => {
    const result = await client.queries.guideConnection();
    expect(result.data.guideConnection.edges).toEqual([]);
  });

  it('guide does not throw and returns fallback data', async () => {
    const result = await client.queries.guide({ relativePath: 'test.mdx' });
    expect(result.data).toHaveProperty('guide');
    expect(result).toHaveProperty('query');
    expect(result).toHaveProperty('variables');
  });
});
