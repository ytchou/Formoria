import { client } from '@tina/client'
import { notFound } from 'next/navigation';

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

export type GuideDetailResult = {
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
  try {
    const result = (await client.queries.guideConnection({
      first: 200,
      filter: { locale: { eq: 'zh-TW' }, draft: { eq: false } },
    })) as TinaGuideConnectionResult;

    const edges = result.data?.guideConnection?.edges ?? [];

    return edges
      .map(edge => edge?.node)
      .filter((node): node is TinaGuideNode => Boolean(node))
      .map(toGuideEntry);
  } catch {
    return [];
  }
}

export async function getGuideBySlug(slug: string): Promise<GuideDetailResult>;
export async function getGuideBySlug(slug: string): Promise<GuideDetailResult> {
  const relativePath = `${slug}.mdx`;
  let tina: TinaGuideResult;
  try {
    tina = (await client.queries.guide({
      relativePath,
    })) as TinaGuideResult;
  } catch {
    notFound();
  }

  const node = tina.data?.guide;
  if (!node) {
    notFound();
  }

  const entry = toGuideEntry(node);

  return {
    entry,
    tina,
  };
}

export async function getGuidesByCategory(category: string): Promise<GuideEntry[]> {
  try {
    const result = (await client.queries.guideConnection({
      first: 200,
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
  } catch {
    return [];
  }
}
