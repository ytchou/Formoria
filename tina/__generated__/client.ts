// Stub — satisfies TypeScript imports; overwritten locally by `pnpm tina:build`

type GuideQueryResult = {
  data: {
    guide: Record<string, unknown>;
  };
  query: string;
  variables: Record<string, unknown>;
};

type GuideConnectionQueryResult = {
  data: {
    guideConnection: {
      edges: Array<{
        node: Record<string, unknown>;
      }>;
    };
  };
};

export const client = {
  queries: {
    guide: async (_args: { relativePath: string }): Promise<GuideQueryResult> => {
      return { data: { guide: {} }, query: '', variables: {} };
    },
    guideConnection: async (_args?: { first?: number; filter?: Record<string, unknown> }): Promise<GuideConnectionQueryResult> => {
      return { data: { guideConnection: { edges: [] } } };
    },
  },
};

export default client;
