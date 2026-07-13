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

export type GuideListResult =
  | { ok: true; guides: GuideEntry[] }
  | { ok: false; error: Error };

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

function guideListError(scope: string, error: unknown): GuideListResult {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  console.error(`[guides:${scope}] TinaCMS query failed`, normalizedError);
  return { ok: false, error: normalizedError };
}

export async function getAllGuides(): Promise<GuideListResult> {
  try {
    const result = (await client.queries.guideConnection({
      first: 200,
      filter: { locale: { eq: 'zh-TW' }, draft: { eq: false } },
    })) as TinaGuideConnectionResult;

    const edges = result.data?.guideConnection?.edges ?? [];

    return {
      ok: true,
      guides: edges
        .map(edge => edge?.node)
        .filter((node): node is TinaGuideNode => Boolean(node))
        .map(toGuideEntry),
    };
  } catch (error) {
    return guideListError('getAllGuides', error);
  }
}

export async function getGuideBySlug(slug: string): Promise<GuideDetailResult>;
export async function getGuideBySlug(slug: string): Promise<GuideDetailResult> {
  const relativePath = `${slug}.mdx`;
  let tina: TinaGuideResult | null | undefined;
  try {
    tina = (await client.queries.guide({
      relativePath,
    })) as TinaGuideResult | null | undefined;
  } catch {
    notFound();
  }

  const node = tina?.data?.guide;
  if (!tina || !node) {
    notFound();
  }

  const entry = toGuideEntry(node);

  return {
    entry,
    tina,
  };
}

export async function getGuidesByCategory(category: string): Promise<GuideListResult> {
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

    return {
      ok: true,
      guides: edges
        .map(edge => edge?.node)
        .filter((node): node is TinaGuideNode => Boolean(node))
        .map(toGuideEntry),
    };
  } catch (error) {
    return guideListError('getGuidesByCategory', error);
  }
}
