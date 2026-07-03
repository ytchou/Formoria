// @ts-expect-error Tina client is generated at build time.
import { client } from '@tina/__generated__/client';

export type GuideEntry = {
  slug: string;
  frontmatter: {
    title: string;
    description?: string;
    slug: string;
    category?: string;
    locale: string;
    publishedAt: string;
    updatedAt?: string;
    draft: boolean;
    sources: string[];
    faq: Array<{ q: string; a: string }>;
  };
};

type TinaGuideNode = {
  title?: string;
  description?: string;
  slug?: string;
  category?: string;
  locale?: string;
  publishedAt?: string;
  updatedAt?: string;
  draft?: boolean;
  sources?: string[];
  faq?: Array<{ q: string; a: string }>;
  body?: string | Record<string, unknown> | null;
};

type TinaGuideResult = {
  data?: {
    guide?: TinaGuideNode | null;
  };
  query?: string;
  variables?: Record<string, unknown>;
};

export type GuideDetailResult = Omit<GuideEntry, 'frontmatter'> & {
  frontmatter: GuideEntry['frontmatter'] & {
    description: string;
    updatedAt: string;
  };
  content: string;
  entry: GuideEntry;
  tina: TinaGuideResult;
};

type TinaGuideConnectionResult = {
  data?: {
    guideConnection?: {
      edges?: Array<{
        node?: TinaGuideNode | null;
      } | null>;
    } | null;
  };
};

function toGuideEntry(node: TinaGuideNode): GuideEntry {
  return {
    slug: node.slug ?? '',
    frontmatter: {
      title: node.title ?? '',
      description: node.description,
      slug: node.slug ?? '',
      category: node.category,
      locale: node.locale ?? 'zh-TW',
      publishedAt: node.publishedAt ?? '',
      updatedAt: node.updatedAt,
      draft: node.draft ?? false,
      sources: node.sources ?? [],
      faq: node.faq ?? [],
    },
  };
}

export async function getAllGuides(): Promise<GuideEntry[]> {
  const result = (await client.queries.guideConnection({
    filter: { locale: { eq: 'zh-TW' }, draft: { eq: false } },
  })) as TinaGuideConnectionResult;

  const edges = result.data?.guideConnection?.edges ?? [];

  return edges
    .map(edge => edge?.node)
    .filter((node): node is TinaGuideNode => Boolean(node))
    .map(toGuideEntry);
}

export async function getGuideBySlug(slug: string): Promise<GuideDetailResult>;
export async function getGuideBySlug(slug: string): Promise<GuideDetailResult | null> {
  const relativePath = `${slug}.mdx`;
  const tina = (await client.queries.guide({
    relativePath,
  })) as TinaGuideResult;

  const node = tina.data?.guide;
  if (!node) {
    return null;
  }

  const entry = toGuideEntry(node);

  return {
    ...entry,
    frontmatter: {
      ...entry.frontmatter,
      description: node.description ?? '',
      updatedAt: node.updatedAt ?? '',
    },
    content: typeof node.body === 'string' ? node.body : '',
    entry,
    tina,
  };
}

export async function getGuidesByCategory(category: string): Promise<GuideEntry[]> {
  const result = (await client.queries.guideConnection({
    filter: {
      category: { eq: category },
      locale: { eq: 'zh-TW' },
      draft: { eq: false },
    },
  })) as TinaGuideConnectionResult;

  const edges = result.data?.guideConnection?.edges ?? [];

  return edges
    .map(edge => edge?.node)
    .filter((node): node is TinaGuideNode => Boolean(node))
    .map(toGuideEntry);
}
