// Filesystem-based guide reader — no Tina server required.
// Reads MDX files from content/guides/ directly so CI and production
// work without running `tinacms dev` alongside the app.
// Locally, `pnpm tina:build` overwrites this file with the real
// HTTP client for Tina Cloud / live editing (git-ignored via tina:build).

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { parseMDX } from '@tinacms/mdx';

const CONTENT_DIR = path.join(process.cwd(), 'content', 'guides');

// Mirrors the rich-text field from tina/config.ts so parseMDX
// resolves BrandCard / StatsCallout / FaqBlock templates correctly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BODY_FIELD: any = {
  type: 'rich-text',
  name: 'body',
  templates: [
    {
      name: 'BrandCard',
      fields: [{ type: 'string', name: 'slug' }],
    },
    {
      name: 'StatsCallout',
      fields: [
        { type: 'string', name: 'stat' },
        { type: 'string', name: 'label' },
      ],
    },
    {
      name: 'FaqBlock',
      fields: [
        {
          type: 'object',
          name: 'questions',
          list: true,
          fields: [
            { type: 'string', name: 'q' },
            { type: 'string', name: 'a' },
          ],
        },
      ],
    },
  ],
};

type GuideNode = Record<string, unknown>;

type GuideQueryResult = {
  data: { guide: GuideNode };
  query: string;
  variables: Record<string, unknown>;
};

type GuideConnectionQueryResult = {
  data: {
    guideConnection: {
      edges: Array<{ node: GuideNode } | null>;
    };
  };
};

function readGuideFile(relativePath: string): GuideNode | null {
  try {
    const filePath = path.join(CONTENT_DIR, relativePath);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(raw);
    const body = parseMDX(content, BODY_FIELD, (s: string) => s);
    return { ...data, body } as GuideNode;
  } catch {
    return null;
  }
}

function listGuideFiles(): string[] {
  try {
    return fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.mdx'));
  } catch {
    return [];
  }
}

export const client = {
  queries: {
    guide: async (args: { relativePath: string }): Promise<GuideQueryResult> => {
      const node = readGuideFile(args.relativePath);
      return {
        data: { guide: node ?? {} },
        query: '',
        variables: {},
      };
    },

    guideConnection: async (args?: {
      first?: number;
      filter?: Record<string, unknown>;
    }): Promise<GuideConnectionQueryResult> => {
      const files = listGuideFiles();
      const edges = files
        .map((file) => {
          const node = readGuideFile(file);
          if (!node) return null;

          const filter = args?.filter as Record<string, Record<string, unknown>> | undefined;
          if (filter?.locale?.eq && node.locale !== filter.locale.eq) return null;
          if (filter?.draft?.eq !== undefined && node.draft !== filter.draft.eq) return null;
          if (filter?.category?.eq && node.category !== filter.category.eq) return null;

          return { node };
        })
        .filter((e): e is { node: GuideNode } => e !== null);

      return { data: { guideConnection: { edges } } };
    },
  },
};

export default client;
